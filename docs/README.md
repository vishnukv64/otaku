# Otaku Landing Page

This directory contains the GitHub Pages landing page for Otaku.

## 🌐 Live Site

**URL**: [https://vishnukv64.github.io/otaku/](https://vishnukv64.github.io/otaku/)

## 📁 Structure

```
docs/
├── index.html          # Main landing page
├── styles.css          # Styling and responsive design
├── script.js           # OS detection and download logic
├── favicon.ico         # Website icon
├── hero-logo.png       # Hero section logo (128x128)
├── nav-icon.png        # Navigation bar icon (32x32)
├── screenshots/        # Application screenshots
│   ├── home-screen.png
│   ├── anime-browser.png
│   ├── video-player.png
│   ├── manga-reader.png
│   ├── library-view.png
│   └── manga-details.png
└── README.md          # This file
```

## 🎨 Design

- **Color Scheme**: Black (#141414) and Red (#e50914) - matching the app theme
- **Typography**: Inter font family
- **Responsive**: Mobile-first design with breakpoints at 640px, 1024px
- **Animations**: Smooth fade-in effects and hover transitions

## ✨ Features

### 1. Automatic OS Detection
- Detects user's operating system (Windows, macOS, Linux)
- Detects architecture (x64, aarch64/Apple Silicon)
- Shows appropriate download button

### 2. GitHub API Integration
- Fetches latest release from GitHub API
- Dynamically updates version numbers
- Shows file sizes
- Provides download links for all platforms

### 3. Responsive Design
- Desktop: Multi-column layouts
- Tablet: 2-column layouts
- Mobile: Single column, stacked content

### 4. Smooth Animations
- Fade-in effects on scroll
- Button hover effects
- Logo pulse animation
- Smooth scrolling

## 🚀 Deployment

The site is automatically deployed via GitHub Actions when changes are pushed to the `main` branch.

### GitHub Actions Workflow
Location: `.github/workflows/deploy-pages.yml`

**Triggers:**
- Push to `main` branch (only when `docs/**` files change)
- Manual workflow dispatch

**Process:**
1. Checkout repository
2. Configure GitHub Pages
3. Upload `docs/` directory as artifact
4. Deploy to GitHub Pages

## 🛠️ Local Development

To test the landing page locally:

```bash
# Navigate to docs directory
cd docs

# Open in browser (or use a local server)
open index.html

# Or use Python's built-in server
python3 -m http.server 8000
# Then visit: http://localhost:8000
```

## 📝 Updating Content

### Update Screenshots
1. Replace images in `docs/screenshots/`
2. Keep same filenames or update references in `index.html`
3. Optimize images for web (recommended: WebP format, < 1MB each)

### Update Version/Download Links
- No action needed! The page automatically fetches the latest release from GitHub API

### Update Text Content
- Edit `index.html` directly
- Sections:
  - Hero: Main title and description
  - Screenshots: Captions and descriptions
  - Features: Feature cards
  - Tech Stack: Technology badges
  - Footer: Links and copyright

### Update Styling
- Edit `styles.css`
- CSS variables are defined at the top for easy theming

## 📊 Analytics (Optional)

To add analytics, insert tracking code in `index.html` before `</head>`:

```html
<!-- Example: Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

## 🔍 SEO

The page includes:
- Meta description and keywords
- Open Graph tags (Facebook, LinkedIn)
- Twitter Card tags
- Semantic HTML5 structure
- Alt text for all images

## 🌍 Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari, Chrome Android

## 📦 Dependencies

**None!** This is a pure HTML/CSS/JavaScript site with:
- No build process required
- No npm packages
- No bundlers
- Single external dependency: Google Fonts (Inter)

## 🐛 Troubleshooting

### Download button not working
- Check GitHub API rate limit: https://api.github.com/rate_limit
- Verify release assets exist in the latest release
- Check browser console for errors

### Images not loading
- Verify paths are correct in `index.html`
- Ensure images exist in `docs/screenshots/`
- Check file permissions

### Page not updating after push
- Wait 1-2 minutes for GitHub Actions to complete
- Check Actions tab in GitHub repository
- Clear browser cache
- Verify GitHub Pages is enabled in repository settings

## 📄 License

Same as parent project (MIT License)
