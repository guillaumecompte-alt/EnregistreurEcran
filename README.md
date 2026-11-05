# Extraits vidéo pour la classe

Application web pour enseignants : enregistrer un passage vidéo (YouTube, Arte.tv, Lumni, INA…),
couper le début et la fin, recadrer l'image, puis télécharger un fichier MP4 prêt à projeter en
classe, sans connexion ni publicité. Tout se passe dans le navigateur : aucune vidéo n'est envoyée
sur un serveur.

**Fonctionnement**

1. Capture d'un onglet du navigateur avec son audio (`getDisplayMedia` + `MediaRecorder`), micro en option.
2. Édition : coupe début/fin, cadre libre ou 16:9 / 4:3 / 1:1, suppression automatique des bandes noires.
3. Export rapide via WebCodecs ([mediabunny](https://mediabunny.dev)) en MP4 H.264/AAC à 30 i/s constants ;
   repli en lecture temps réel sur les navigateurs sans WebCodecs.

**Limites** : les plateformes protégées par DRM (Netflix, Disney+, Prime Video, Canal+…) donnent une
image noire — l'application le détecte et prévient l'utilisateur. Le son d'un onglet n'est capté que
par Chrome et Edge sur ordinateur.

Le code utile est dans `src/routes/index.tsx`, `src/components/recorder/` et `src/lib/video/`.

---

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
