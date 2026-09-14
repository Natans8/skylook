# Skylook

Every skybox and screen effect of World of Warcraft, pictured through the day with the Epsilon commands that put
each one in the game, and a viewer that draws any sky of any build from Classic Era to Midnight in the browser.

**<https://natans8.github.io/skylook/>**

## What is here

| path                          | what it is                                                                         |
|-------------------------------|------------------------------------------------------------------------------------|
| `site/index.html`, `gallery.js` | the gallery, one panorama per skybox and one picture per screen effect           |
| `site/sky.html`, `app.js`, `app.css` | the viewer's interface                                                      |
| `site/sky.js`                 | the engine: the sky cone, the day cycle, the skybox model, screen effects, exports |
| `site/wowload.js`             | reads M2 models and BLP textures in the browser                                    |
| `site/assets.js`              | where client files and light tables are fetched from                               |
| `site/encode.js`, `gifworker.js` | loop export: gifski for GIF, the browser's own encoder for mp4 and webm         |
| `site/ts.*.js`                | the screen-effect constants, cloud noise and gallery card rules, compiled from TypeScript |
| `site/lib/`                   | three.js, @wowserhq/format, mediabunny and gifski-wasm                             |
| `site/data/versions/`         | the build roster and each build's light tables, gzipped (Git LFS)                  |
| `site/data/gallery/`          | the drawn gallery pictures and their index (Git LFS)                               |
| `site/data/epsilon_map.json`  | each 9.2.7 skybox's Epsilon spells and gameobject displays                         |

Models and textures are not stored here. The viewer fetches each file from wago.tools when a sky is opened.

`site/` is staged by the publish script of the skybox tooling that produces the tables and the pictures, so a
change made in `site/` directly is overwritten by the next publish.

## Running it locally

Any static file server over `site/`:

```bash
python -m http.server -d site 8000
```

## Deploying

A push to `main` deploys through `.github/workflows/pages.yml`, which pulls the LFS objects and uploads `site/` to
GitHub Pages. The repository's Pages source is set to GitHub Actions.

## Licence

The code is licensed under the GNU Affero General Public License, version 3 or later. The vendored libraries keep
their own licences, and the game data is not ours to license. `NOTICE` has the details.
