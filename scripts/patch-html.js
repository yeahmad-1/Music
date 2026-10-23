const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
if (fs.existsSync(htmlPath)) {
  let content = fs.readFileSync(htmlPath, 'utf8');

  // Replace deprecated apple-mobile-web-app-capable with mobile-web-app-capable
  content = content.replace(
    /<meta\s+name=["']apple-mobile-web-app-capable["'][^>]*\/?>/gi,
    '<meta name="mobile-web-app-capable" content="yes" />'
  );

  // Ensure mobile-web-app-capable exists and remove any redundant duplicates
  const matches = content.match(/<meta name="mobile-web-app-capable" content="yes" \/>/g);
  if (matches && matches.length > 1) {
    let count = 0;
    content = content.replace(/<meta name="mobile-web-app-capable" content="yes" \/>/g, () => {
      count++;
      return count === 1 ? '<meta name="mobile-web-app-capable" content="yes" />' : '';
    });
  }

  if (!content.includes('name="mobile-web-app-capable"')) {
    content = content.replace(
      '<meta name="viewport"',
      '<meta name="mobile-web-app-capable" content="yes" />\n    <meta name="viewport"'
    );
  }

  // Inject console warning/error filter into <head> so deprecated warnings, inert/aria-hidden notes & responder touch errors never pollute DevTools
  const filterScript = `
    <script id="filter-console-logs">
      (function() {
        var origWarn = console.warn;
        console.warn = function() {
          var firstArg = arguments[0];
          if (firstArg && typeof firstArg === 'string') {
            if (
              firstArg.indexOf('Expo AV has been deprecated') !== -1 ||
              firstArg.indexOf('Consider using the inert attribute') !== -1 ||
              firstArg.indexOf('aria-hidden section of the WAI-ARIA') !== -1 ||
              firstArg.indexOf('The play() request was interrupted') !== -1
            ) {
              return;
            }
          }
          return origWarn.apply(console, arguments);
        };
        var origError = console.error;
        console.error = function() {
          var firstArg = arguments[0];
          if (firstArg && typeof firstArg === 'string') {
            if (
              firstArg.indexOf('Cannot record touch end without a touch start') !== -1 ||
              firstArg.indexOf('Cannot record touch move without a touch start') !== -1 ||
              firstArg.indexOf('The play() request was interrupted') !== -1 ||
              firstArg.indexOf('AbortError') !== -1
            ) {
              return;
            }
          }
          return origError.apply(console, arguments);
        };
      })();
    </script>`;

  if (content.includes('id="filter-console-logs"')) {
    content = content.replace(/<script id="filter-console-logs">[\s\S]*?<\/script>/, filterScript.trim());
  } else {
    content = content.replace('</head>', `${filterScript}\n  </head>`);
  }

  fs.writeFileSync(htmlPath, content, 'utf8');
  console.log('[HTML] Patched dist/index.html: ensured mobile-web-app-capable, silenced expo-av deprecation and responder touch errors');
}
