"""Génère les icônes PNG et l'image de partage à partir du logo SVG.

Nécessite Playwright (pip install playwright && playwright install chromium).
Usage : python scripts/make_icons.py
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

ICONS = Path(__file__).resolve().parent.parent / "site" / "icons"

FOOT = (
    "M32 59C27.5 59 24.5 56 22.5 51.5L7.2 20.6C6 17.5 7.6 15 10.5 15.8Q21 19 30 7.2C31 5.6 33 5.6 34 7.2"
    "Q43 19 53.5 15.8C56.4 15 58 17.5 56.8 20.6L41.5 51.5C39.5 56 36.5 59 32 59Z"
)
TOES = "M27.5 41.5L14.5 21.5M32 39V12.5M36.5 41.5L49.5 21.5"


def mark(scale: float, offset: float = 1.6) -> str:
    pad = (64 - 64 * scale) / 2
    return f"""
    <g transform="translate({pad:.2f} {pad + 1:.2f}) scale({scale})">
      <path fill="#e6007e" transform="translate(-{offset} {offset})" d="{FOOT}"/>
      <path fill="#000" d="{FOOT}"/>
      <path fill="none" stroke="#ffd400" stroke-width="2.4" stroke-linecap="round" d="{TOES}"/>
    </g>"""


def square_icon(scale: float, rounded: bool) -> str:
    rx = ' rx="14"' if rounded else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"{rx} fill="#ffd400"/>{mark(scale)}</svg>'


OG = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght,BNCE,INFM@300..800,-100..100,0..100&display=swap">
<style>
  body {{ margin: 0; width: 1200px; height: 630px; background: #fff; font-family: 'Shantell Sans', sans-serif; }}
  .page {{ position: absolute; inset: 28px; display: grid; grid-template-columns: 1fr 360px; gap: 22px; }}
  .panel {{ border: 6px solid #000; padding: 44px 48px; display: flex; flex-direction: column; justify-content: space-between; }}
  h1 {{ margin: 0; font-size: 150px; line-height: .84; font-weight: 800; letter-spacing: -.02em;
       font-variation-settings: "INFM" 100, "BNCE" 60;
       text-shadow: -5px 4px 0 #e6007e, 4px -3px 0 #009fe3; }}
  p {{ margin: 0; font-size: 38px; font-weight: 600; }}
  .foot {{ background: #ffd400; display: grid; place-items: center; }}
  .foot svg {{ width: 250px; height: 250px; }}
</style></head><body><div class="page">
  <div class="panel"><h1>Coup de<br>Patte</h1><p>Qui a dessiné cette case ?</p></div>
  <div class="panel foot"><svg viewBox="0 0 64 64">{mark(1, 2.2)}</svg></div>
</div></body></html>"""


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    (ICONS / "favicon.svg").write_text(square_icon(0.84, True) + "\n", encoding="utf-8")
    renders = {
        "favicon-32.png": (square_icon(0.84, True), 32),
        "icon-192.png": (square_icon(0.84, True), 192),
        "icon-512.png": (square_icon(0.84, True), 512),
        "apple-touch-icon.png": (square_icon(0.74, False), 180),
        "icon-maskable-512.png": (square_icon(0.62, False), 512),
    }
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, (svg, size) in renders.items():
            page = browser.new_page(viewport={"width": size, "height": size})
            page.set_content(f'<body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</body>')
            page.screenshot(path=str(ICONS / name), omit_background=True)
            page.close()
        page = browser.new_page(viewport={"width": 1200, "height": 630})
        page.set_content(OG, wait_until="networkidle")
        page.wait_for_timeout(400)
        page.screenshot(path=str(ICONS / "og.png"))
        browser.close()
    print("Icônes écrites dans", ICONS)


if __name__ == "__main__":
    main()
