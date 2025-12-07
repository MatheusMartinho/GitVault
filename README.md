# GitHub Desktop Client

An advanced GitHub desktop client built with Electron, React, Node.js, and direct Git CLI integration.

## Features

- Clone remote repositories (HTTPS and SSH)
- Navigate between local and remote branches
- Commit and sync changes (push/pull)
- View commit history with details (author, date, message)
- Highlight code changes (diff viewer)
- Manage multiple repositories
- Collaboration features like pull request notifications
- Repository analytics including contribution activity graphs and engagement statistics

## Prerequisites

- Node.js (v14 or higher)
- Git CLI installed and configured
- npm or yarn package manager

## Installation

1. Clone this repository:
   ```
   git clone <repository-url>
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the React frontend:
   ```
   npm run build
   ```

4. Start the application:
   ```
   npm start
   ```

## Development

To run the application in development mode:

1. Start the webpack development server:
   ```
   npm run watch
   ```

2. In another terminal, start the Electron app:
   ```
   npm start
   ```

## Architecture

The application follows a standard Electron architecture with separate main and renderer processes:

- `main.js`: Entry point for the Electron main process
- `preload.js`: Exposes secure APIs to the renderer process
- `main-process-handlers.js`: Handles Git operations and system interactions
- `src/`: Contains all React components and frontend code

### Security

This application follows Electron's security best practices:
- Context isolation enabled
- Node integration disabled in renderer process
- Secure IPC communication between processes

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.