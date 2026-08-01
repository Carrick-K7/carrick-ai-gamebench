# GameBench web fonts

The public site self-hosts these unmodified Google Fonts files:

- Oxanium variable: modern game-interface display face.
- Silkscreen Regular and Bold: pixel-theme display face.

Source: `google/fonts` commit `2796410152d4f9524b68ed46e69c1b60f8e0f7c3`.
Both families are distributed under the SIL Open Font License 1.1. The exact
license text for each family is retained in `licenses/`.

The Chinese interface also self-hosts:

- CAGB Rounded SC: a modern-theme display face derived from WenYuan Rounded
  SC v1.000. The upstream `WenYuanRoundedSCVF.otf` SHA-256 is
  `4546841f16a30a8d9006c1bfe023a4d3ce7fcfccf514e94467f0673eb5a7db4a`.
  The web font keeps the variable `100–900` weight range and contains all
  GB2312 characters plus the upstream font's available glyphs from
  U+0020–00FF, U+2000–206F, U+3000–303F, and U+FF00–FFEF. Characters outside
  that set fall back to the system Chinese font. Because the upstream OFL
  declaration reserves the WenYuan family names, this modified subset is
  internally named `CAGB Rounded SC`. Its
  SHA-256 is
  `b49766c0a61a9e5e4a73f0c94ab9b8b35d976c08e12a81f3ce9c0e8b6c788301`.
- Fusion Pixel Font 10px proportional SC 2026.07.20: pixel-theme Chinese
  display face.

The CAGB Rounded SC subset was generated with FontTools `pyftsubset`, keeping
all layout features and variable-font tables, then renamed in its OpenType
`name` table. Both Chinese families are distributed under the SIL Open Font
License 1.1. Their exact license texts are retained in `licenses/`.
