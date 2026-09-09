# TootPic

Convert Fediverse posts into clean, beautiful, shareable images.

## Features

- **Multi-platform support**: Works with Mastodon, Misskey, Pixelfed, PeerTube, Pleroma, and other ActivityPub platforms.
- **Custom instance emojis**: Full rendering support for local and remote custom emojis across federated instances.
- **Quoted post cards**: Neatly displays quoted posts beneath main content with author attribution and full-frame media.
- **Rich content & polls**: Renders image grids, video badges, spoiler warnings (CW), and poll results accurately.
- **Card customization**: Classic and Magazine layouts in light and dark themes, with toggles for stats, timestamps, and usernames.
- **Export & clipboard**: Download high-res PNGs or copy directly to your clipboard, completely watermark-free.
- **Accessibility-first**: Automatically copies post text to your clipboard as Alt text for inclusive sharing.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Eyozy/tootpic.git
   ```

2. Navigate to the project directory:
   ```bash
   cd tootpic
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

### Development

Start the development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:4321`.

## Commands

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project for production
- `npm run preview` - Preview the production build locally
- `npm run astro` - Run Astro CLI commands

## Contributing

Contributions are welcome. Feel free to submit issues, suggestions, or pull requests.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
