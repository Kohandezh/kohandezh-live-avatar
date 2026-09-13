/*
 * svgo settings for the AI Voice artwork in `public/images/ai-voice.svg`.
 *
 * How to redo it if the artwork is ever replaced:
 *
 *   npx svgo --config scripts/svgo.ai-voice.config.mjs -i <new art>.svg \
 *     -o public/images/ai-voice.svg
 *
 * Then rebuild the still frame that reduced motion uses, by deleting every SMIL element:
 *
 *   node -e "const fs=require('fs');const s=fs.readFileSync('public/images/ai-voice.svg','utf8');\
 *   fs.writeFileSync('public/images/ai-voice-still.svg',s.replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g,''))"
 *
 * WHY THESE SETTINGS, AND NOT THE DEFAULTS
 * ----------------------------------------
 * The artwork is an After Effects style SMIL export: about 2300 groups, 330 shapes, 890
 * <animate> and 630 <animateTransform>. Plain `npx svgo` cuts it from 467 KB to 14 KB, which
 * looks wonderful and is wrong: it leaves 3 shapes and 6 animations, because most elements
 * start at `visibility="hidden"` or `scale(0)` and only SMIL brings them in. `removeHiddenElems`
 * deletes them, and the picture is gone.
 *
 * So every plugin that can delete an element an <animate> points at, or fold a group an
 * <animateTransform> lives on, is off below. What is left is number rounding and whitespace:
 * 467 KB down to 436 KB, about 11 KB over the wire once the server gzips it, and the picture
 * is byte-for-byte the same thing on screen. Checked frame by frame against the original in a
 * real browser.
 *
 * `convertEllipseToCircle` is left ON. It rewrote 325 ellipses whose rx equals ry as circles,
 * which is safe here because nothing in the file animates `rx` or `ry` (the only animated
 * attributes are `transform`, `visibility` and `opacity`).
 */
export default {
  multipass: true,
  js2svg: { indent: 0, pretty: false },
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // Deletes the elements SMIL is about to reveal.
          removeHiddenElems: false,
          // Each of these can fold away a group that an animateTransform targets.
          collapseGroups: false,
          moveElemsAttrsToGroup: false,
          moveGroupAttrsToElems: false,
          convertShapeToPath: false,
          mergePaths: false,
          removeEmptyContainers: false,
          // The gradients and the mask are reached by id from deep inside the tree.
          removeUselessDefs: false,
          cleanupIds: false,
          removeUnusedNS: false,
          // Rounding only. Two decimals in a 700 unit viewBox is well under a pixel.
          convertPathData: { floatPrecision: 2 },
          cleanupNumericValues: { floatPrecision: 2 },
          convertTransform: { floatPrecision: 2 },
        },
      },
    },
  ],
};
