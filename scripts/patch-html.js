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

  fs.writeFileSync(htmlPath, content, 'utf8');
  console.log('[HTML] Patched dist/index.html: ensured mobile-web-app-capable and removed deprecated apple tags');
}
