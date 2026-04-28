# Orbserve

Orbserve turns an image into a physics-driven field of colored particles. Choose a source image, tune how the particles move, adjust where they enter the canvas, then export the finished motion as a video.

![Orbserve screenshot](docs/orbserve.png)

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Tech

- [React](https://react.dev/) and [Vite](https://vite.dev/) for the app shell and build tooling.
- [Rapier](https://rapier.rs/) for the 2D physics simulation.
- [PixiJS](https://pixijs.com/) for fast canvas/WebGL rendering.
- [Zustand](https://zustand.docs.pmnd.rs/) for local state.
- [Tailwind CSS](https://tailwindcss.com/) and [Radix UI](https://www.radix-ui.com/) primitives for the interface.

## Note

This project was generated with the help of AI.
