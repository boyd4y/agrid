# Avatar sources

All avatar generation is local. Generated member SVGs are rasterized/cropped to WebP before saving; uploaded PNG/JPEG/WebP images use the same bounded private storage. Agent avatars store a validated `bloub:shape:color:expression` configuration and render through the separate React bot component. Agents do not offer file uploads.

- **Notionists** by Zoish, via [DiceBear Notionists](https://www.dicebear.com/styles/notionists/), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Changes: generated combinations, crop and WebP conversion.
- **Croodles – Doodle your face** by [Vijay Verma](https://vjy.me/), via [DiceBear Croodles](https://www.dicebear.com/styles/croodles/), [original artwork](https://www.figma.com/community/file/966199982810283152), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: generated combinations, crop and WebP conversion. Credit and license links appear in the picker.
- **bloub** by Jérémy Perret, [source](https://github.com/jeremy-prt/bloub), MIT. The original engine and full license are retained in `client/src/lib/bloub/`; React rendering and theme-aware automatic color are tabdo integrations.
