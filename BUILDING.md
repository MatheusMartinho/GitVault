# 🏗️ Build Instructions for GitVault

This document explains how to build GitVault for distribution.

## Prerequisites

Before building GitVault, ensure you have:

- Node.js 16+ installed
- Git installed and configured
- macOS, Windows, or Linux operating system
- For macOS: Xcode command line tools (`xcode-select --install`)
- For Windows: Windows Build Tools (`npm install --global windows-build-tools`)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/seu-usuario/gitvault.git
cd gitvault
```

2. Install dependencies:
```bash
npm install
```

## Development

To run in development mode:
```bash
npm start
```

To run in development mode with auto-rebuild:
```bash
npm run dev
```

## Building for Distribution

### Build for your current platform:
```bash
npm run build
```

### Build for specific platforms:

**For Windows:**
```bash
npm run build:win
```

**For macOS:**
```bash
npm run build:mac
```

**For Linux:**
```bash
npm run build:linux
```

## Build Output

The built application will be available in the `dist-app/` directory:

- **Windows**: `.exe` installer and `.zip` portable version
- **macOS**: `.dmg` disk image and `.zip` archive  
- **Linux**: `.AppImage`, `.deb`, `.rpm`, and `.zip` versions

## Available Build Targets

| Platform | Format | Description |
|----------|--------|-------------|
| Windows | NSIS (.exe) | Installable executable |
| Windows | ZIP (.zip) | Portable version |
| macOS | DMG (.dmg) | Disk image for installation |
| macOS | ZIP (.zip) | Archive for portable use |
| Linux | AppImage (.AppImage) | Portable executable |
| Linux | DEB (.deb) | Debian package |
| Linux | RPM (.rpm) | Red Hat package |
| Linux | ZIP (.zip) | Archive for portable use |

## Customizing the Build

You can customize the build by modifying the `build` configuration in `package.json`:

- `productName` - Application name
- `appId` - Unique identifier for the app
- `directories.output` - Output directory
- Platform-specific settings (mac, win, linux)

## Troubleshooting

### Common Build Issues

**Problem**: Build fails on Windows
**Solution**: Ensure Windows Build Tools are installed:
```bash
npm install --global windows-build-tools
```

**Problem**: Build fails on macOS
**Solution**: Install Xcode command line tools:
```bash
xcode-select --install
```

**Problem**: Build fails on Linux
**Solution**: Install build essentials:
```bash
# Ubuntu/Debian
sudo apt-get install build-essential

# CentOS/RHEL/Fedora  
sudo yum install gcc gcc-c++ make
```

### Verifying Your Build

After building, verify your application works by:

1. Running the packaged version locally
2. Testing all main features (add repo, commit, push, pull)
3. Checking that the UI renders correctly
4. Ensuring notifications work properly

## Distribution

The built applications can be distributed to users:

- Provide the appropriate installer for their platform
- For macOS: `.dmg` files are most user-friendly
- For Windows: `.exe` installers are most common
- For Linux: AppImage files are most portable

## Versioning

To update the version number, modify the `version` field in `package.json`:
```json
{
  "version": "1.0.0"
}
```

## Next Steps

1. Update the version number before building a release
2. Test on different machines before distribution
3. Consider code signing for production releases
4. Create GitHub releases with built assets