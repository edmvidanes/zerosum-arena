# Sprite asset credits

## Martial Hero (fighter sprites)
- Author: LuizMelo (https://luizmelo.itch.io/)
- Source packs: "Martial Hero" (Samurai) — https://luizmelo.itch.io/martial-hero — and "Martial Hero 2" (Kenji) — https://luizmelo.itch.io/martial-hero-2
- Sprite PNGs were fetched from public GitHub mirrors of those packs (gengen1988/unity-martial-hero, rizqureshy/streetf2), then repacked/recolored locally with the script kept outside the repo
- License: CC0 (public domain dedication) — "Assets are CC0" per the pack page
- Usage here: frames were cropped, repacked into `app/public/sprites/fighters-sheet.png`
  (8 poses x 12 palette-variant fighters), and hue-shifted to create 12 selectable
  fighters. No Dragon Ball / Spriters Resource assets are used: those sheets depict
  copyrighted characters with no usable license for public deployment, so this
  CC0 martial-arts set is used instead with DBZ-inspired aura/beam effects in CSS.
- Poses per fighter: idle (2 frames), charge, attack (energy slash), hit, block, KO, win.

## Fighter roster (25) + Avatar Builder
- Roster reduced from 50 hue clones to 25 curated fighters (12 armor palettes x 2 bases + 1 gold champion).
- Players can build a custom fighter (base style, armor color, helm, weapon, aura) or randomize one; new players start with a random custom fighter. Custom fighters are encoded as c<base>.<armor>.<helm>.<weapon>.<aura> and rendered from the same sprite sheet with vector helm/weapon overlays.


## Update: single original fighter
- Removed the LuizMelo sprite sheets, the 25-fighter roster, and all helm/weapon overlays.
- The game now uses ONE original vector fighter drawn in code (SVG), with 7 poses (idle, charge, attack, hit, block, KO, win) and 8 color themes. No external character assets are used.
