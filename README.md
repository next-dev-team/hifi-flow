# Hifi Flow

Music player app with uniwind for Android, iOS and web

> **Disclaimer**: This project is for educational purposes only, testing `hero-native` with `uniwind` to build universal Expo apps (Android, iOS, and Web) with one codebase.

## Feature

- Simple with Hifi audio quality
- Daily favorite tracks

## Screenshots

<img src="./resources/modal-player.jpg" width="250" alt="Bottom Sheet Modal">
<img src="./resources/bar.jpg" width="250" alt="Player Bar">

## Tech Stack

- **TypeScript** - For type safety and improved developer experience
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

Then, run the development server:

```bash
pnpm run dev
```

Use the Expo Go app to run the mobile application.

## Project Structure

```
my-better-t-app/
├── apps/
│   ├── native/      # Mobile application (React Native, Expo)
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run dev:native`: Start the React Native/Expo development server
