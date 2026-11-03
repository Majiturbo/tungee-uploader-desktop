"""Builds the Windows artwork from the square app icon:
resources/icon-win.png and .ico (rounded icon), installer/app/icon.png, and installer/build/splash.bmp
(shown while the installer unpacks itself)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "resources/icon-v2.png"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
SIZE = 1024
INSET = 0.04
RADIUS = 0.22
SUPERSAMPLE = 4


def rounded_icon() -> Image.Image:
    art = Image.open(SOURCE).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    big = SIZE * SUPERSAMPLE
    inset = round(big * INSET)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, big - inset, big - inset), radius=round(big * RADIUS), fill=255)
    mask = mask.resize((SIZE, SIZE), Image.LANCZOS)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(art, (0, 0), mask)
    return icon


def splash(icon: Image.Image, title_text: str) -> Image.Image:
    scale = 2
    width, height = 340 * scale, 120 * scale
    card = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(card)
    mark = 56 * scale
    card.paste(icon.resize((mark, mark), Image.LANCZOS), (32 * scale, (height - mark) // 2), icon.resize((mark, mark), Image.LANCZOS))
    title = ImageFont.truetype(FONT, 17 * scale, index=1)
    body = ImageFont.truetype(FONT, 12.5 * scale, index=0)
    left = (32 + 56 + 16) * scale
    draw.text((left, 38 * scale), title_text, font=title, fill=(30, 30, 30))
    draw.text((left, 66 * scale), "正在打开安装程序…", font=body, fill=(128, 128, 128))
    draw.rectangle((0, 0, width - 1, height - 1), outline=(225, 225, 228), width=scale)
    return card.resize((340, 120), Image.LANCZOS)


icon = rounded_icon()
icon.save(ROOT / "resources/icon-win.png")
icon.save(ROOT / "resources/icon-win.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
icon.resize((256, 256), Image.LANCZOS).save(ROOT / "installer/app/icon.png")
(ROOT / "installer/build").mkdir(exist_ok=True)
splash(icon, "探迹话术上传助手").save(ROOT / "installer/build/splash.bmp")
splash(icon, "探迹话术上传助手轻量版").save(ROOT / "installer/build/splash-lite.bmp")
print("ok")
