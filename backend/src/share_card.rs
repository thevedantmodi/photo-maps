//! The 1080×1920 story-style share card.
//!
//! The TypeScript backend laid this out as JSX and rendered it with satori (`next/og`).
//! Here the same layout is computed directly and drawn as SVG with resvg, which is also what
//! satori used to rasterize. Values mirror the design-system tokens that lived in
//! `src/lib/shareTokens.ts`; the source of truth is project/tokens.json in the Design System
//! artifact 5Cei2PGXh8r6JKN1WEZM7W.
//!
//! What satori did implicitly and is reproduced here:
//! * CSS line boxes: `normal` line height is the font's hhea ascender − descender, and text
//!   sits in the middle of its line box (half-leading).
//! * Wrapping at Unicode line-break opportunities, collapsing whitespace.
//! * Emoji the fonts have no glyph for are drawn from Twemoji SVGs, fetched from the same
//!   CDN as next/og.
//! * Outer box shadows are Gaussian blurs with σ = blur radius / 2, clipped to outside the
//!   box; the glass plate's inset highlight is clipped to its padding box.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, Utc};
use image::RgbImage;
use skrifa::raw::TableProvider;
use skrifa::{FontRef, MetadataProvider};
use unicode_segmentation::UnicodeSegmentation;

use crate::imaging;
use crate::js;

// ---- Tokens -----------------------------------------------------------------------------
// Authored as 1x CSS px and multiplied by 2.5: the card is a 1080px canvas viewed on a
// ~390pt phone.

const CARD_W: f64 = 1080.0;
const CARD_H: f64 = 1920.0;
/// Instagram overlays its caption bar and reply box across roughly the top and bottom
/// 250px of a story; nothing readable may sit inside these bands.
const SAFE_INSET: f64 = 300.0;
const SIDE_PADDING: f64 = 84.0;

const PHOTO_MAX_W: u32 = 912;
const PHOTO_MAX_H: u32 = 1000;
/// radius-xs (4px) scaled, rounded to the nearest even px.
const PHOTO_RADIUS: f64 = 10.0;
/// shadow-photo, scaled: `0 50px 125px rgba(0, 0, 0, 0.5)`.
const PHOTO_SHADOW: Shadow = Shadow { dy: 50.0, blur: 125.0, opacity: 0.5 };

/// The ambient layer: the same photo, blurred to fill the frame.
const AMBIENT_BLUR: f64 = 70.0;
const AMBIENT_BRIGHTNESS: f64 = 0.72;
const AMBIENT_SATURATION: f64 = 1.6;
const AMBIENT_QUALITY: u8 = 60;
/// The ambient layer is blurred beyond recognition, so it is rendered at a quarter size
/// and scaled up.
const AMBIENT_DIVISOR: f64 = 4.0;

/// The liquid-glass plate. Translucent rather than blurred: the ambient layer behind it is
/// already blurred, so a flat translucent fill reads as frosted glass.
const GLASS_FILL: (u8, u8, u8, f64) = (28, 28, 30, 0.58);
const GLASS_BORDER_W: f64 = 3.0;
const GLASS_BORDER_OPACITY: f64 = 0.18;
const GLASS_RADIUS: f64 = 72.0;
/// `0 32px 90px rgba(0, 0, 0, 0.45)`.
const GLASS_SHADOW: Shadow = Shadow { dy: 32.0, blur: 90.0, opacity: 0.45 };
/// `inset 0 3px 0 rgba(255, 255, 255, 0.15)`: the glass highlight from the shadow-toggle token.
const GLASS_HIGHLIGHT_DY: f64 = 3.0;
const GLASS_HIGHLIGHT_OPACITY: f64 = 0.15;
const GLASS_PAD_Y: f64 = 48.0;
const GLASS_PAD_X: f64 = 56.0;
const GLASS_GAP: f64 = 52.0;

const QR_SIZE: f64 = 216.0;
const QR_PADDING: f64 = 20.0;
const QR_RADIUS: f64 = 28.0;
/// `0 14px 40px rgba(0, 0, 0, 0.3)`.
const QR_SHADOW: Shadow = Shadow { dy: 14.0, blur: 40.0, opacity: 0.3 };

/// Gap between the photo and the plate below it.
const PLATE_GAP: f64 = 60.0;
/// Gap between rows of the text column, and the URL row's extra top margin.
const ROW_GAP: f64 = 14.0;
const URL_MARGIN_TOP: f64 = 4.0;

/// The ground behind everything if a layer fails to draw (background token, dark theme).
const BACKGROUND: &str = "#0a0a0a";

const CAPTION: TextStyle =
    TextStyle { font: Face::SemiBold, size: 50.0, letter_spacing: -1.0, line_height: Some(1.15), opacity: 1.0 };
const DATE: TextStyle =
    TextStyle { font: Face::Regular, size: 32.0, letter_spacing: 0.0, line_height: None, opacity: 0.82 };
const URL: TextStyle =
    TextStyle { font: Face::Mono, size: 26.0, letter_spacing: 0.0, line_height: None, opacity: 0.72 };

/// Width of the text column inside the plate: the card, less the side padding, the plate's
/// own padding and border, the gap, and the QR tile.
const TEXT_WIDTH: f64 =
    CARD_W - 2.0 * SIDE_PADDING - 2.0 * GLASS_PAD_X - 2.0 * GLASS_BORDER_W - GLASS_GAP - (QR_SIZE + 2.0 * QR_PADDING);

const MAX_CAPTION_LINES: usize = 4;

const TWEMOJI_BASE: &str = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/";

#[derive(Clone, Copy)]
struct Shadow {
    dy: f64,
    blur: f64,
    opacity: f64,
}

// ---- Fonts --------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Face {
    Regular,
    SemiBold,
    Mono,
}

static GEIST_REGULAR: &[u8] = include_bytes!("../fonts/Geist-Regular.ttf");
static GEIST_SEMIBOLD: &[u8] = include_bytes!("../fonts/Geist-SemiBold.ttf");
static GEIST_MONO: &[u8] = include_bytes!("../fonts/GeistMono-Regular.ttf");

impl Face {
    fn data(self) -> &'static [u8] {
        match self {
            Face::Regular => GEIST_REGULAR,
            Face::SemiBold => GEIST_SEMIBOLD,
            Face::Mono => GEIST_MONO,
        }
    }

    fn family(self) -> &'static str {
        match self {
            Face::Regular | Face::SemiBold => "Geist",
            Face::Mono => "Geist Mono",
        }
    }

    fn weight(self) -> u16 {
        match self {
            Face::SemiBold => 600,
            _ => 400,
        }
    }
}

#[derive(Clone, Copy)]
struct TextStyle {
    font: Face,
    size: f64,
    letter_spacing: f64,
    /// A multiple of the font size; None is CSS `normal`.
    line_height: Option<f64>,
    opacity: f64,
}

/// What text layout needs from a font: advances (with kerning), coverage, and the hhea
/// vertical metrics satori used.
struct FontMetrics {
    font: harfrust::FontRef<'static>,
    shaper_data: harfrust::ShaperData,
    charmap: skrifa::charmap::Charmap<'static>,
    units_per_em: f64,
    ascender: f64,
    descender: f64,
}

impl FontMetrics {
    fn load(face: Face) -> Result<Self> {
        let data = face.data();
        let font = harfrust::FontRef::new(data).map_err(|e| anyhow!("load {face:?}: {e:?}"))?;
        let skrifa_font = FontRef::new(data).map_err(|e| anyhow!("load {face:?}: {e:?}"))?;
        let hhea = skrifa_font.hhea().map_err(|e| anyhow!("{face:?} hhea: {e:?}"))?;
        let head = skrifa_font.head().map_err(|e| anyhow!("{face:?} head: {e:?}"))?;
        Ok(FontMetrics {
            shaper_data: harfrust::ShaperData::new(&font),
            charmap: skrifa_font.charmap(),
            units_per_em: f64::from(head.units_per_em()),
            ascender: f64::from(hhea.ascender().to_i16()),
            descender: f64::from(hhea.descender().to_i16()),
            font,
        })
    }

    fn has_glyphs(&self, grapheme: &str) -> bool {
        grapheme
            .chars()
            // Joiners and variation selectors are formatting, not glyphs of their own.
            .filter(|c| !matches!(c, '\u{200D}' | '\u{FE0E}' | '\u{FE0F}'))
            .all(|c| self.charmap.map(c).is_some())
    }

    /// Advance width of a run of text in px, letter spacing excluded.
    ///
    /// Unkerned, like everything satori measured and drew: its font engine applies no
    /// kerning, so wrap points and line lengths only match with kerning off.
    fn advance(&self, text: &str, size: f64) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        let shaper = self.shaper_data.shaper(&self.font).build();
        let mut buffer = harfrust::UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let no_kern = [harfrust::Feature::new(harfrust::Tag::new(b"kern"), 0, ..)];
        let output = shaper.shape(buffer, harfrust::ShapeOptions::new().features(&no_kern));
        let units: i64 = output.glyph_positions().iter().map(|p| i64::from(p.x_advance)).sum();
        units as f64 * size / self.units_per_em
    }

    /// Exact height of one line box.
    fn exact_line_height(&self, style: &TextStyle) -> f64 {
        match style.line_height {
            Some(m) => m * style.size,
            None => (self.ascender - self.descender) / self.units_per_em * style.size,
        }
    }

    /// Height of one line box, rounded to whole pixels as satori lays lines out.
    fn line_height(&self, style: &TextStyle) -> f64 {
        js_round(self.exact_line_height(style))
    }

    /// Distance from the top of a line box to the baseline, rounded like the line height.
    fn baseline(&self, style: &TextStyle) -> f64 {
        let asc = self.ascender / self.units_per_em * style.size;
        let content = (self.ascender - self.descender) / self.units_per_em * style.size;
        js_round(asc + (self.exact_line_height(style) - content) / 2.0)
    }
}

// ---- Public API ---------------------------------------------------------------------------

/// The subset of a photo that determines what its share card shows.
#[derive(Clone, Debug)]
pub struct CardInput {
    pub friendly_name: String,
    pub caption: Option<String>,
    pub original_name: String,
    pub date: Option<DateTime<Utc>>,
}

pub struct ShareCardRenderer {
    fontdb: Arc<usvg::fontdb::Database>,
    metrics: HashMap<Face, FontMetrics>,
    http: reqwest::Client,
    /// Twemoji SVGs by icon code; None records a code the CDN does not have.
    emoji_cache: Mutex<HashMap<String, Option<Arc<Vec<u8>>>>>,
}

use resvg::usvg;

impl ShareCardRenderer {
    pub fn new(http: reqwest::Client) -> Result<Self> {
        let mut db = usvg::fontdb::Database::new();
        for face in [Face::Regular, Face::SemiBold, Face::Mono] {
            db.load_font_data(face.data().to_vec());
        }
        let metrics = [Face::Regular, Face::SemiBold, Face::Mono]
            .into_iter()
            .map(|f| Ok((f, FontMetrics::load(f)?)))
            .collect::<Result<_>>()?;
        Ok(ShareCardRenderer { fontdb: Arc::new(db), metrics, http, emoji_cache: Mutex::new(HashMap::new()) })
    }

    /// Renders a card to PNG bytes from the photo's large rendition (a JPEG).
    pub async fn render(self: &Arc<Self>, input: &CardInput, large_jpeg: Vec<u8>, base: &str) -> Result<Vec<u8>> {
        let text = CardText::new(input, base);
        let emoji = self.load_emoji(&text).await;
        let this = Arc::clone(self);
        tokio::task::spawn_blocking(move || this.render_blocking(&text, &emoji, &large_jpeg))
            .await
            .context("share card render task")?
    }

    fn metrics(&self, face: Face) -> &FontMetrics {
        &self.metrics[&face]
    }

    /// Graphemes in `text` that the font cannot draw but Twemoji can.
    fn emoji_codes(&self, text: &str, face: Face) -> Vec<String> {
        let m = self.metrics(face);
        text.graphemes(true).filter(|g| is_emoji_candidate(g) && !m.has_glyphs(g)).map(icon_code).collect()
    }

    async fn load_emoji(&self, text: &CardText) -> HashMap<String, Arc<Vec<u8>>> {
        let mut codes: HashSet<String> = HashSet::new();
        codes.extend(self.emoji_codes(&text.caption, CAPTION.font));
        if let Some(d) = &text.date {
            codes.extend(self.emoji_codes(d, DATE.font));
        }
        codes.extend(self.emoji_codes(&text.url, URL.font));

        let mut out = HashMap::new();
        for code in codes {
            let cached = self.emoji_cache.lock().unwrap().get(&code).cloned();
            let svg = match cached {
                Some(hit) => hit,
                None => {
                    let fetched = self.fetch_emoji(&code).await;
                    // Only remember definite answers; a network blip should be retried.
                    if let Ok(v) = &fetched {
                        self.emoji_cache.lock().unwrap().insert(code.clone(), v.clone());
                    }
                    fetched.ok().flatten()
                }
            };
            if let Some(svg) = svg {
                out.insert(code, svg);
            }
        }
        out
    }

    async fn fetch_emoji(&self, code: &str) -> Result<Option<Arc<Vec<u8>>>> {
        let res = self
            .http
            .get(format!("{TWEMOJI_BASE}{}.svg", code.to_lowercase()))
            .timeout(Duration::from_secs(5))
            .send()
            .await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let res = res.error_for_status()?;
        Ok(Some(Arc::new(res.bytes().await?.to_vec())))
    }

    fn render_blocking(
        &self,
        text: &CardText,
        emoji: &HashMap<String, Arc<Vec<u8>>>,
        large_jpeg: &[u8],
    ) -> Result<Vec<u8>> {
        let source = imaging::decode_jpeg(large_jpeg).context("share card source")?;

        let fitted = imaging::resize_inside(&source, PHOTO_MAX_W, PHOTO_MAX_H.min(text.photo_max_height));
        let fitted_jpeg = imaging::encode_jpeg(&fitted, 82)?;
        let ambient = ambient_layer(&source)?;
        let qr = qr_path(&text.permalink)?;

        let svg = self.compose(text, emoji, &fitted, &fitted_jpeg, &ambient, &qr);

        let opts =
            usvg::Options { fontdb: Arc::clone(&self.fontdb), font_family: "Geist".into(), ..Default::default() };
        let tree = usvg::Tree::from_str(&svg, &opts).context("share card SVG")?;
        let mut pixmap =
            resvg::tiny_skia::Pixmap::new(CARD_W as u32, CARD_H as u32).ok_or_else(|| anyhow!("pixmap"))?;
        resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());
        pixmap.encode_png().context("encode share card PNG")
    }

    /// Wraps text into lines no wider than `max_width`, at Unicode line-break opportunities.
    fn wrap(
        &self,
        text: &str,
        style: &TextStyle,
        max_width: f64,
        emoji: &HashMap<String, Arc<Vec<u8>>>,
    ) -> Vec<String> {
        let text = collapse_whitespace(text);
        if text.is_empty() {
            return Vec::new();
        }
        let mut segments = Vec::new();
        let mut start = 0;
        for (i, _) in unicode_linebreak::linebreaks(&text) {
            if i > start {
                segments.push(&text[start..i]);
            }
            start = i;
        }

        let mut lines: Vec<String> = Vec::new();
        let mut line = String::new();
        let fits = |s: &str| self.measure(s.trim_end(), style, emoji) <= max_width + 0.01;
        for seg in segments {
            let candidate = format!("{line}{seg}");
            if line.is_empty() || fits(&candidate) {
                line = candidate;
            } else {
                lines.push(line.trim_end().to_owned());
                line = seg.to_owned();
            }
            // A single segment wider than the column (a long URL slug, say) is broken
            // between graphemes rather than left to run under the QR code.
            while !fits(&line) {
                let graphemes: Vec<&str> = line.graphemes(true).collect();
                let mut head = String::new();
                for g in &graphemes {
                    if !head.is_empty() && !fits(&format!("{head}{g}")) {
                        break;
                    }
                    head.push_str(g);
                }
                if head.len() == line.len() {
                    break;
                }
                line = line[head.len()..].to_owned();
                lines.push(head.trim_end().to_owned());
            }
        }
        if !line.trim_end().is_empty() {
            lines.push(line.trim_end().to_owned());
        }
        lines
    }

    /// Splits a line into text runs and emoji images, each with its width.
    fn runs<'a>(&self, line: &'a str, style: &TextStyle, emoji: &HashMap<String, Arc<Vec<u8>>>) -> Vec<Run<'a>> {
        let m = self.metrics(style.font);
        let mut runs: Vec<Run> = Vec::new();
        let mut text_start: Option<usize> = None;
        for (i, g) in line.grapheme_indices(true) {
            let is_image = is_emoji_candidate(g) && !m.has_glyphs(g) && emoji.contains_key(&icon_code(g));
            if is_image {
                if let Some(s) = text_start.take() {
                    runs.push(self.text_run(&line[s..i], style));
                }
                // An emoji image is exactly one em wide; satori adds no letter spacing to it.
                runs.push(Run::Emoji { code: icon_code(g), width: style.size });
            } else if text_start.is_none() {
                text_start = Some(i);
            }
        }
        if let Some(s) = text_start {
            runs.push(self.text_run(&line[s..], style));
        }
        runs
    }

    fn text_run<'a>(&self, text: &'a str, style: &TextStyle) -> Run<'a> {
        let width = self.metrics(style.font).advance(text, style.size)
            + style.letter_spacing * text.graphemes(true).count() as f64;
        Run::Text { text, width }
    }

    fn measure(&self, text: &str, style: &TextStyle, emoji: &HashMap<String, Arc<Vec<u8>>>) -> f64 {
        self.runs(text, style, emoji).iter().map(Run::width).sum()
    }

    #[allow(clippy::too_many_arguments)]
    fn compose(
        &self,
        text: &CardText,
        emoji: &HashMap<String, Arc<Vec<u8>>>,
        fitted: &RgbImage,
        fitted_jpeg: &[u8],
        ambient_jpeg: &[u8],
        qr: &QrPath,
    ) -> String {
        let caption_lines = self.wrap(&text.caption, &CAPTION, TEXT_WIDTH, emoji);
        let date_lines = text.date.as_deref().map(|d| self.wrap(d, &DATE, TEXT_WIDTH, emoji)).unwrap_or_default();
        let url_lines = self.wrap(&text.url, &URL, TEXT_WIDTH, emoji);

        let lh = |s: &TextStyle| self.metrics(s.font).line_height(s);
        // Rows of the text column, top to bottom: (style, lines, extra top margin).
        let mut rows: Vec<(&TextStyle, &[String], f64)> = vec![(&CAPTION, &caption_lines, 0.0)];
        if text.date.is_some() {
            rows.push((&DATE, &date_lines, 0.0));
        }
        rows.push((&URL, &url_lines, URL_MARGIN_TOP));
        let text_h: f64 = rows.iter().map(|(s, lines, mt)| mt + lines.len() as f64 * lh(s)).sum::<f64>()
            + ROW_GAP * (rows.len() - 1) as f64;

        let tile = QR_SIZE + 2.0 * QR_PADDING;
        let content_h = text_h.max(tile);
        let plate_h = 2.0 * GLASS_PAD_Y + 2.0 * GLASS_BORDER_W + content_h;
        let plate_x = SIDE_PADDING;
        let plate_w = CARD_W - 2.0 * SIDE_PADDING;
        let plate_y = CARD_H - SAFE_INSET - plate_h;
        let content_y = plate_y + GLASS_BORDER_W + GLASS_PAD_Y;
        let text_x = plate_x + GLASS_BORDER_W + GLASS_PAD_X;
        let tile_x = plate_x + plate_w - GLASS_BORDER_W - GLASS_PAD_X - tile;
        let tile_y = content_y + (content_h - tile) / 2.0;

        // The photo sits on the plate with PLATE_GAP between them, centred horizontally.
        let (pw, ph) = (f64::from(fitted.width()), f64::from(fitted.height()));
        let photo_x = SIDE_PADDING + (plate_w - pw) / 2.0;
        let photo_y = plate_y - PLATE_GAP - ph;

        let mut s = String::with_capacity(fitted_jpeg.len() * 2);
        let _ = write!(
            s,
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}">"#,
            w = n(CARD_W),
            h = n(CARD_H)
        );
        s.push_str("<defs>");
        let plate = rrect(plate_x, plate_y, plate_w, plate_h, GLASS_RADIUS);
        let inner = rrect(
            plate_x + GLASS_BORDER_W,
            plate_y + GLASS_BORDER_W,
            plate_w - 2.0 * GLASS_BORDER_W,
            plate_h - 2.0 * GLASS_BORDER_W,
            GLASS_RADIUS - GLASS_BORDER_W,
        );
        let tile_shape = rrect(tile_x, tile_y, tile, tile, QR_RADIUS);
        // Each blur only needs the shadow's box plus 3σ, where a Gaussian has all but died
        // out; a canvas-sized region makes the render many times slower for nothing.
        let shadows = [
            ("photo-shadow", PHOTO_SHADOW, (photo_x, photo_y, pw, ph)),
            ("plate-shadow", GLASS_SHADOW, (plate_x, plate_y, plate_w, plate_h)),
            ("qr-shadow", QR_SHADOW, (tile_x, tile_y, tile, tile)),
        ];
        for (id, shadow, (x, y, w, h)) in shadows {
            let reach = 1.5 * shadow.blur; // 3σ
            let _ = write!(
                s,
                r#"<filter id="{id}" filterUnits="userSpaceOnUse" x="{}" y="{}" width="{}" height="{}"><feGaussianBlur stdDeviation="{}"/></filter>"#,
                n(x - reach),
                n(y + shadow.dy - reach),
                n(w + 2.0 * reach),
                n(h + 2.0 * reach),
                n(shadow.blur / 2.0)
            );
        }
        let _ = write!(
            s,
            r#"<clipPath id="photo-clip"><path d="{}"/></clipPath>"#,
            rrect(photo_x, photo_y, pw, ph, PHOTO_RADIUS)
        );
        let _ = write!(s, r#"<clipPath id="plate-inner"><path d="{inner}"/></clipPath>"#);
        for (id, shape, shadow, (x, y, w, h)) in [
            ("outside-plate", &plate, GLASS_SHADOW, (plate_x, plate_y, plate_w, plate_h)),
            ("outside-tile", &tile_shape, QR_SHADOW, (tile_x, tile_y, tile, tile)),
        ] {
            let reach = 1.5 * shadow.blur;
            let (mx, my, mw, mh) = (n(x - reach), n(y + shadow.dy - reach), n(w + 2.0 * reach), n(h + 2.0 * reach));
            let _ = write!(
                s,
                r##"<mask id="{id}" maskUnits="userSpaceOnUse" x="{mx}" y="{my}" width="{mw}" height="{mh}"><rect x="{mx}" y="{my}" width="{mw}" height="{mh}" fill="#fff"/><path d="{shape}" fill="#000"/></mask>"##
            );
        }
        s.push_str("</defs>");

        // Ground and ambient layer.
        let _ = write!(s, r#"<rect width="{}" height="{}" fill="{BACKGROUND}"/>"#, n(CARD_W), n(CARD_H));
        let _ = write!(
            s,
            r#"<image x="0" y="0" width="{}" height="{}" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,{}"/>"#,
            n(CARD_W),
            n(CARD_H),
            STANDARD.encode(ambient_jpeg)
        );

        // Photo and its shadow (opaque, so the shadow needs no clipping).
        let _ = write!(
            s,
            r##"<path d="{}" fill="#000" fill-opacity="{}" filter="url(#photo-shadow)"/>"##,
            rrect(photo_x, photo_y + PHOTO_SHADOW.dy, pw, ph, PHOTO_RADIUS),
            n(PHOTO_SHADOW.opacity)
        );
        let _ = write!(
            s,
            r#"<image x="{}" y="{}" width="{}" height="{}" clip-path="url(#photo-clip)" xlink:href="data:image/jpeg;base64,{}"/>"#,
            n(photo_x),
            n(photo_y),
            n(pw),
            n(ph),
            STANDARD.encode(fitted_jpeg)
        );

        // Glass plate: shadow, fill, border, inset highlight.
        let _ = write!(
            s,
            r##"<g mask="url(#outside-plate)"><path d="{}" fill="#000" fill-opacity="{}" filter="url(#plate-shadow)"/></g>"##,
            rrect(plate_x, plate_y + GLASS_SHADOW.dy, plate_w, plate_h, GLASS_RADIUS),
            n(GLASS_SHADOW.opacity)
        );
        let (r, g, b, a) = GLASS_FILL;
        let _ = write!(s, r#"<path d="{plate}" fill="rgb({r},{g},{b})" fill-opacity="{}"/>"#, n(a));
        let _ = write!(
            s,
            r##"<path d="{plate} {inner}" fill-rule="evenodd" fill="#fff" fill-opacity="{}"/>"##,
            n(GLASS_BORDER_OPACITY)
        );
        let shifted = rrect(
            plate_x + GLASS_BORDER_W,
            plate_y + GLASS_BORDER_W + GLASS_HIGHLIGHT_DY,
            plate_w - 2.0 * GLASS_BORDER_W,
            plate_h - 2.0 * GLASS_BORDER_W,
            GLASS_RADIUS - GLASS_BORDER_W,
        );
        let _ = write!(
            s,
            r##"<path d="{inner} {shifted}" fill-rule="evenodd" clip-path="url(#plate-inner)" fill="#fff" fill-opacity="{}"/>"##,
            n(GLASS_HIGHLIGHT_OPACITY)
        );

        // Text column, vertically centred against the QR tile.
        let mut y = content_y + (content_h - text_h) / 2.0;
        for (i, (style, lines, margin_top)) in rows.iter().enumerate() {
            if i > 0 {
                y += ROW_GAP;
            }
            y += margin_top;
            let m = self.metrics(style.font);
            for line in lines.iter() {
                self.draw_line(&mut s, line, style, text_x, y, m.line_height(style), m.baseline(style), emoji);
                y += m.line_height(style);
            }
        }

        // QR tile.
        let _ = write!(
            s,
            r##"<g mask="url(#outside-tile)"><path d="{}" fill="#000" fill-opacity="{}" filter="url(#qr-shadow)"/></g>"##,
            rrect(tile_x, tile_y + QR_SHADOW.dy, tile, tile, QR_RADIUS),
            n(QR_SHADOW.opacity)
        );
        let _ = write!(s, r##"<path d="{tile_shape}" fill="#fff"/>"##);
        let _ = write!(
            s,
            r##"<g transform="translate({} {}) scale({})"><path d="{}" fill="#000"/></g>"##,
            n(tile_x + QR_PADDING),
            n(tile_y + QR_PADDING),
            n(QR_SIZE / f64::from(qr.modules)),
            qr.d
        );

        s.push_str("</svg>");
        s
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_line(
        &self,
        s: &mut String,
        line: &str,
        style: &TextStyle,
        x0: f64,
        top: f64,
        line_h: f64,
        baseline: f64,
        emoji: &HashMap<String, Arc<Vec<u8>>>,
    ) {
        let mut x = x0;
        for run in self.runs(line, style, emoji) {
            match &run {
                Run::Text { text, .. } => {
                    let _ = write!(
                        s,
                        r##"<text x="{}" y="{}" font-family="{}" font-weight="{}" font-size="{}" letter-spacing="{}" font-kerning="none" fill="#fff" fill-opacity="{}" xml:space="preserve">{}</text>"##,
                        n(x),
                        n(top + baseline),
                        style.font.family(),
                        style.font.weight(),
                        n(style.size),
                        n(style.letter_spacing),
                        n(style.opacity),
                        xml_escape(text)
                    );
                }
                Run::Emoji { code, .. } => {
                    if let Some(svg) = emoji.get(code) {
                        let _ = write!(
                            s,
                            r#"<image x="{}" y="{}" width="{}" height="{}" opacity="{}" xlink:href="data:image/svg+xml;base64,{}"/>"#,
                            n(x),
                            n(top + (line_h - style.size) / 2.0),
                            n(style.size),
                            n(style.size),
                            n(style.opacity),
                            STANDARD.encode(svg.as_slice())
                        );
                    }
                }
            }
            x += run.width();
        }
    }
}

enum Run<'a> {
    Text { text: &'a str, width: f64 },
    Emoji { code: String, width: f64 },
}

impl Run<'_> {
    fn width(&self) -> f64 {
        match self {
            Run::Text { width, .. } | Run::Emoji { width, .. } => *width,
        }
    }
}

// ---- Card text ----------------------------------------------------------------------------

struct CardText {
    caption: String,
    date: Option<String>,
    /// The typeable fallback printed on the card, protocol stripped.
    url: String,
    /// What the QR code encodes.
    permalink: String,
    photo_max_height: u32,
}

impl CardText {
    fn new(input: &CardInput, base: &str) -> Self {
        let raw_caption = match input.caption.as_deref() {
            Some(c) if !c.is_empty() => c,
            _ => &input.original_name,
        };
        let date = input.date.as_ref().map(js::format_long_date);
        let permalink = format!("{base}/p/{}", input.friendly_name);
        let url = permalink
            .strip_prefix("https://")
            .or_else(|| permalink.strip_prefix("http://"))
            .unwrap_or(&permalink)
            .to_owned();
        let (caption, photo_max_height) = estimate_layout(raw_caption, date.is_some(), &url);
        CardText { caption, date, url, permalink, photo_max_height }
    }
}

/// The plate is laid out after the photo is resized, so its height is estimated from the
/// text it will hold and the photo gets whatever vertical space is left: a long caption
/// shrinks the photo instead of overlapping it. Same arithmetic as the TypeScript `layout`,
/// so photos come out the same size; the plate itself is then laid out from measured text.
fn estimate_layout(caption: &str, has_date: bool, url: &str) -> (String, u32) {
    // Geist averages ~0.52em per character at these sizes; Geist Mono is a true 0.6em.
    let caption_chars_per_line = (TEXT_WIDTH / (CAPTION.size * 0.52)).floor() as usize;
    let url_chars_per_line = (TEXT_WIDTH / (URL.size * 0.6)).floor() as usize;
    let limit = MAX_CAPTION_LINES * caption_chars_per_line;

    let clamped = if js::utf16_len(caption) > limit {
        format!("{}…", js::utf16_prefix(caption, limit - 1).trim_end_matches(js::is_js_whitespace))
    } else {
        caption.to_owned()
    };

    let ceil_div = |len: usize, per: usize| len.div_ceil(per);
    let caption_lines = ceil_div(js::utf16_len(&clamped), caption_chars_per_line).clamp(1, MAX_CAPTION_LINES);
    let url_lines = ceil_div(js::utf16_len(url), url_chars_per_line).max(1);
    let rows = 1 + usize::from(has_date) + 1;
    let plate_height = 2.0 * GLASS_PAD_Y
        + 6.0
        + caption_lines as f64 * CAPTION.size * CAPTION.line_height.unwrap_or(1.0)
        + if has_date { DATE.size * 1.4 } else { 0.0 }
        + url_lines as f64 * URL.size * 1.4
        + (rows - 1) as f64 * ROW_GAP
        + 4.0;
    let available = CARD_H - 2.0 * SAFE_INSET - PLATE_GAP - plate_height;
    (clamped, js_round(available).max(420.0) as u32)
}

/// `Math.round`: halves round up.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// CSS `white-space: normal`: runs of spaces, tabs and newlines become one space and the
/// ends are trimmed.
fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars() {
        if matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{c}') {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(c);
        }
    }
    out
}

/// Could this grapheme be an emoji? The final say is whether the font lacks it, as in satori.
fn is_emoji_candidate(g: &str) -> bool {
    !g.is_ascii() && (emojis::get(g).is_some() || emojis::get(&g.replace('\u{FE0F}', "")).is_some())
}

/// next/og's `getIconCode`: code points in lowercase hex joined by '-', with U+FE0F dropped
/// unless the sequence contains a zero-width joiner.
fn icon_code(g: &str) -> String {
    let keep_fe0f = g.contains('\u{200D}');
    g.chars()
        .filter(|&c| keep_fe0f || c != '\u{FE0F}')
        .map(|c| format!("{:x}", u32::from(c)))
        .collect::<Vec<_>>()
        .join("-")
}

// ---- Layers -------------------------------------------------------------------------------

/// The photo scaled to cover the card at a quarter size, blurred, darkened and saturated,
/// as `sharp().resize(cover).blur(σ).modulate()` produced it.
fn ambient_layer(source: &RgbImage) -> Result<Vec<u8>> {
    let w = (CARD_W / AMBIENT_DIVISOR) as u32;
    let h = (CARD_H / AMBIENT_DIVISOR) as u32;
    let covered = imaging::resize_cover(source, w, h);
    let blurred = gaussian_blur(&covered, AMBIENT_BLUR / AMBIENT_DIVISOR);
    let modulated = modulate(&blurred, AMBIENT_BRIGHTNESS, AMBIENT_SATURATION);
    imaging::encode_jpeg(&modulated, AMBIENT_QUALITY)
}

/// libvips `gaussblur` as sharp calls it: a separable Gaussian truncated where it falls
/// below 0.2 of its peak, with integer weights, and edges extended by copying.
fn gaussian_blur(img: &RgbImage, sigma: f64) -> RgbImage {
    let sig2 = 2.0 * sigma * sigma;
    let max_x = (8.0 * sigma).clamp(0.0, 5000.0) as i64;
    let mut x = 0;
    while x < max_x {
        if (-((x * x) as f64) / sig2).exp() < 0.2 {
            break;
        }
        x += 1;
    }
    let half = (x - 1).max(0);
    let weights: Vec<f64> = (-half..=half).map(|i| (20.0 * (-((i * i) as f64) / sig2).exp()).round()).collect();
    let sum: f64 = weights.iter().sum();

    let (w, h) = img.dimensions();
    let (wi, hi) = (i64::from(w), i64::from(h));
    let src = img.as_raw();
    let mut tmp = vec![0f64; src.len()];
    for y in 0..hi {
        for x in 0..wi {
            for c in 0..3 {
                let mut acc = 0.0;
                for (k, wt) in weights.iter().enumerate() {
                    let sx = (x + k as i64 - half).clamp(0, wi - 1);
                    acc += wt * f64::from(src[((y * wi + sx) * 3 + c) as usize]);
                }
                tmp[((y * wi + x) * 3 + c) as usize] = acc / sum;
            }
        }
    }
    let mut out = RgbImage::new(w, h);
    let dst: &mut [u8] = out.as_mut();
    for y in 0..hi {
        for x in 0..wi {
            for c in 0..3 {
                let mut acc = 0.0;
                for (k, wt) in weights.iter().enumerate() {
                    let sy = (y + k as i64 - half).clamp(0, hi - 1);
                    acc += wt * tmp[((sy * wi + x) * 3 + c) as usize];
                }
                dst[((y * wi + x) * 3 + c) as usize] = (acc / sum).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// sharp's `modulate({ brightness, saturation })`: in CIE LCh (D65), L is multiplied by
/// `brightness` and C by `saturation`, then back to sRGB.
fn modulate(img: &RgbImage, brightness: f64, saturation: f64) -> RgbImage {
    let mut out = img.clone();
    for p in out.pixels_mut() {
        let [l, a, b] = srgb_to_lab(p.0);
        let (c, hue) = (a.hypot(b) * saturation, b.atan2(a));
        p.0 = lab_to_srgb([l * brightness, c * hue.cos(), c * hue.sin()]);
    }
    out
}

const D65: [f64; 3] = [95.047, 100.0, 108.883];

fn srgb_to_linear(v: u8) -> f64 {
    let v = f64::from(v) / 255.0;
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(v: f64) -> u8 {
    let v = if v <= 0.003_130_8 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 };
    (v * 255.0).round().clamp(0.0, 255.0) as u8
}

fn srgb_to_lab(rgb: [u8; 3]) -> [f64; 3] {
    let [r, g, b] = rgb.map(srgb_to_linear);
    let xyz = [
        (0.4124 * r + 0.3576 * g + 0.1805 * b) * 100.0,
        (0.2126 * r + 0.7152 * g + 0.0722 * b) * 100.0,
        (0.0193 * r + 0.1192 * g + 0.9505 * b) * 100.0,
    ];
    let f = |t: f64| if t > 216.0 / 24389.0 { t.cbrt() } else { (24389.0 / 27.0 * t + 16.0) / 116.0 };
    let [fx, fy, fz] = [f(xyz[0] / D65[0]), f(xyz[1] / D65[1]), f(xyz[2] / D65[2])];
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn lab_to_srgb(lab: [f64; 3]) -> [u8; 3] {
    let fy = (lab[0] + 16.0) / 116.0;
    let fx = fy + lab[1] / 500.0;
    let fz = fy - lab[2] / 200.0;
    let finv = |t: f64| {
        let t3 = t * t * t;
        if t3 > 216.0 / 24389.0 { t3 } else { (116.0 * t - 16.0) * 27.0 / 24389.0 }
    };
    let (x, y, z) = (finv(fx) * D65[0] / 100.0, finv(fy) * D65[1] / 100.0, finv(fz) * D65[2] / 100.0);
    let r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
    let g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
    let b = 0.0557 * x - 0.2040 * y + 1.0570 * z;
    [linear_to_srgb(r), linear_to_srgb(g), linear_to_srgb(b)]
}

struct QrPath {
    /// Path data in module units, one square per dark module.
    d: String,
    modules: u32,
}

/// QR code with error correction level M and no quiet zone (the white tile is the margin).
fn qr_path(data: &str) -> Result<QrPath> {
    use qrcode::{Color, EcLevel, QrCode};
    let code = QrCode::with_error_correction_level(data.as_bytes(), EcLevel::M).context("QR code")?;
    let width = code.width();
    let mut d = String::new();
    for (i, c) in code.to_colors().iter().enumerate() {
        if *c == Color::Dark {
            let _ = write!(d, "M{} {}h1v1h-1z", i % width, i / width);
        }
    }
    Ok(QrPath { d, modules: width as u32 })
}

// ---- SVG helpers --------------------------------------------------------------------------

/// A number for SVG attributes: up to three decimals, no trailing zeros.
fn n(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.to_owned() }
}

/// Path data for a rounded rectangle, radius clamped as CSS does.
fn rrect(x: f64, y: f64, w: f64, h: f64, r: f64) -> String {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    format!(
        "M{} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}Z",
        n(x + r),
        n(y),
        n(x + w - r),
        n(x + w),
        n(y + r),
        n(y + h - r),
        n(x + w - r),
        n(y + h),
        n(x + r),
        n(x),
        n(y + h - r),
        n(y + r),
        n(x + r),
        n(y),
        r = n(r)
    )
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Characters XML 1.0 cannot carry at all.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn renderer() -> ShareCardRenderer {
        ShareCardRenderer::new(reqwest::Client::new()).unwrap()
    }

    #[test]
    fn layout_estimate_matches_typescript() {
        assert_eq!(TEXT_WIDTH, 486.0);
        // Same numbers the TypeScript layout() gives for these inputs.
        let (c, h) = estimate_layout("Dawn in Yucca Valley", true, "photos.vedantmodi.com/p/yucca-dawn");
        assert_eq!((c.as_str(), h), ("Dawn in Yucca Valley", 893));
        // The satori reference render of this card has a 930px-tall portrait photo.
        let (_, h) = estimate_layout("Sunset 🌅 at the pier — café time", true, "photos.vedantmodi.com/p/sunset");
        assert_eq!(h, 930);
        let long = "x".repeat(100);
        let (c, h) = estimate_layout(&long, false, "a.b/p/c");
        assert_eq!(js::utf16_len(&c), 72);
        assert!(c.ends_with('…'));
        assert_eq!(h, 874);
        let (c, _) = estimate_layout(&format!("{}    {}", "y".repeat(68), "z".repeat(10)), false, "u");
        assert_eq!(c, format!("{}…", "y".repeat(68)));
    }

    #[test]
    fn whitespace_collapses() {
        assert_eq!(collapse_whitespace("  a \n\t b  "), "a b");
        assert_eq!(collapse_whitespace("a\u{a0}\u{a0}b"), "a\u{a0}\u{a0}b");
        assert_eq!(collapse_whitespace(""), "");
    }

    #[test]
    fn icon_codes_match_next_og() {
        assert_eq!(icon_code("🌅"), "1f305");
        assert_eq!(icon_code("❤\u{FE0F}"), "2764");
        assert_eq!(icon_code("👩\u{200D}❤\u{FE0F}\u{200D}👨"), "1f469-200d-2764-fe0f-200d-1f468");
        assert_eq!(icon_code("🇺🇸"), "1f1fa-1f1f8");
    }

    #[test]
    fn emoji_detection_defers_to_font_coverage() {
        let r = renderer();
        assert_eq!(r.emoji_codes("Sunset 🌅 — café", Face::SemiBold), vec!["1f305".to_owned()]);
        assert!(r.emoji_codes("© 2024 – “quotes”", Face::Regular).is_empty());
    }

    #[test]
    fn line_metrics() {
        let r = renderer();
        let m = r.metrics(Face::SemiBold);
        // Geist's hhea metrics are 1005/-295 per 1000 em: `normal` is 1.3em. satori rounds
        // line boxes and baselines to whole pixels. Values computed with satori's formulas
        // in JS; 50 * 1.15 is 57.49999999999999 in doubles, so the caption line is 57px.
        assert_eq!(m.line_height(&CAPTION), 57.0);
        assert_eq!(m.baseline(&CAPTION), 46.0);
        assert_eq!(r.metrics(Face::Regular).line_height(&DATE), 42.0);
        assert_eq!(r.metrics(Face::Regular).baseline(&DATE), 32.0);
        assert_eq!(r.metrics(Face::Mono).line_height(&URL), 34.0);
        assert_eq!(r.metrics(Face::Mono).baseline(&URL), 26.0);
    }

    #[test]
    fn wrapping_respects_width_and_breaks_long_words() {
        let r = renderer();
        let none = HashMap::new();
        // satori wraps this caption at widths below 495px and keeps it on one line from 495.
        let lines = r.wrap("Dawn in Yucca Valley", &CAPTION, TEXT_WIDTH, &none);
        assert_eq!(lines, vec!["Dawn in Yucca", "Valley"]);
        assert_eq!(r.wrap("Dawn in Yucca Valley", &CAPTION, 494.0, &none).len(), 2);
        assert_eq!(r.wrap("Dawn in Yucca Valley", &CAPTION, 495.0, &none).len(), 1);
        let url = r.wrap("photos.vedantmodi.com/p/yucca-dawn", &URL, TEXT_WIDTH, &none);
        assert_eq!(url, vec!["photos.vedantmodi.com/p/yucca-", "dawn"]);
        let long = r.wrap(&"w".repeat(60), &CAPTION, TEXT_WIDTH, &none);
        assert!(long.len() > 1);
        for l in &long {
            assert!(r.measure(l, &CAPTION, &none) <= TEXT_WIDTH + 0.01, "{l}");
        }
        assert!(r.wrap("   ", &CAPTION, TEXT_WIDTH, &none).is_empty());
    }

    #[test]
    fn numbers_and_escaping() {
        assert_eq!(n(1.0), "1");
        assert_eq!(n(1.25), "1.25");
        assert_eq!(n(-0.0001), "0");
        assert_eq!(xml_escape("a<b>&\"'\u{1}"), "a&lt;b&gt;&amp;&quot;&apos;");
    }

    #[test]
    fn color_round_trip_is_stable() {
        for rgb in [[0, 0, 0], [255, 255, 255], [12, 200, 77], [128, 128, 128]] {
            assert_eq!(lab_to_srgb(srgb_to_lab(rgb)), rgb);
        }
    }
}
