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

  // Inject console warning/error filter into <head> so deprecated warnings & responder touch errors never pollute DevTools
  if (!content.includes('filter-console-logs')) {
    const filterScript = `
    <script id="filter-console-logs">
      (function() {
        var origWarn = console.warn;
        console.warn = function() {
          if (arguments[0] && typeof arguments[0] === 'string' && arguments[0].indexOf('Expo AV has been deprecated') !== -1) {
            return;
          }
          return origWarn.apply(console, arguments);
        };
        var origError = console.error;
        console.error = function() {
          if (arguments[0] && typeof arguments[0] === 'string' && (
            arguments[0].indexOf('Cannot record touch end without a touch start') !== -1 ||
            arguments[0].indexOf('Cannot record touch move without a touch start') !== -1
          )) {
            return;
          }
          return origError.apply(console, arguments);
        };
      })();
    </script>`;

    content = content.replace('</head>', `${filterScript}\n  </head>`);
  }

  fs.writeFileSync(htmlPath, content, 'utf8');
  console.log('[HTML] Patched dist/index.html: ensured mobile-web-app-capable, silenced expo-av deprecation and responder touch errors');
}
