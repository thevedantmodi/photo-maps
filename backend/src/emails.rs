//! The confirmation and weekly digest emails.
//!
//! These were React Email components (`src/emails/*.tsx`). The markup below is what they
//! rendered, reproduced byte for byte, and the plain-text part follows the rules
//! react-email's html-to-text pass applied. `tests/fixtures/emails` holds renders from the
//! original components; the tests compare against them.
//!
//! Styling is the light-theme subset of the Photo Maps design system (tokens.json in the
//! design-system artifact), inlined because email clients ignore CSS variables.

use std::fmt::Write as _;

use crate::js;

pub struct Email {
    pub html: String,
    pub text: String,
}

/// One photo in the digest.
#[derive(Clone, Debug)]
pub struct DigestPhoto {
    pub title: String,
    pub url: String,
    pub image_url: String,
    /// Formatted date taken, if known.
    pub date: Option<String>,
}

pub struct Digest<'a> {
    pub base_url: &'a str,
    /// Lead photo, shown full width from the large rendition.
    pub hero: &'a DigestPhoto,
    /// The rest, two to a row from thumbnails.
    pub rest: &'a [DigestPhoto],
    /// New photos beyond the ones shown.
    pub more: usize,
    /// Resend fills this per recipient when the broadcast sends.
    pub unsubscribe_url: &'a str,
}

const BRAND: &str = "Photos by Vedant Modi";

const HEAD_START: &str = r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head><meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/><meta name="x-apple-disable-message-reformatting"/>"#;
const BODY_START: &str = r#"<body dir="ltr" lang="en" style="background-color:#f5f5f5;margin:0;padding:0"><!--$--><!--html--><!--head--><!--body--><table border="0" width="100%" cellPadding="0" cellSpacing="0" role="presentation" align="center"><tbody><tr><td dir="ltr" lang="en" style="background-color:#f5f5f5;font-family:Geist, -apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, Helvetica, Arial, sans-serif;margin:0;padding:24px 0">"#;
const PREVIEW_START: &str = r#"<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0" data-skip-in-text="true">"#;
const CONTAINER_START: &str = r#"<table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:560px;background-color:#ffffff;border-radius:10px"><tbody><tr style="width:100%"><td style="padding:32px 28px"><p style="font-size:12px;line-height:24px;color:#999999;font-weight:600;letter-spacing:0.08em;margin:0 0 24px;text-transform:uppercase;margin-top:0;margin-right:0;margin-bottom:24px;margin-left:0">Photos by Vedant Modi</p><h1 style="color:#171717;font-size:22px;font-weight:600;line-height:30px;margin:0 0 12px">"#;
const END: &str = "</td></tr></tbody></table></td></tr></tbody></table><!--/$--></body></html>";
const SECTION_START: &str =
    r#"<table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style=""#;
const SECTION_MID: &str = r#""><tbody><tr><td>"#;
const SECTION_END: &str = "</td></tr></tbody></table>";
const BUTTON_STYLE: &str = "line-height:100%;text-decoration:none;display:inline-block;max-width:100%;mso-padding-alt:0px;background-color:#171717;border-radius:30px;box-sizing:border-box;color:#ffffff;font-size:15px;font-weight:500;padding:12px 24px;padding-top:12px;padding-right:24px;padding-bottom:12px;padding-left:24px";
const BUTTON_PRE: &str = r#"<span><!--[if mso]><i style="mso-font-width:400%;mso-text-raise:18px" hidden>&#8202;&#8202;&#8202;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:9px">"#;
const BUTTON_POST: &str = r#"</span><span><!--[if mso]><i style="mso-font-width:400%" hidden>&#8202;&#8202;&#8202;&#8203;</i><![endif]--></span></a>"#;
const HR: &str =
    r#"<hr style="width:100%;border:none;border-color:transparent;border-top:1px solid #eeeeee;margin:28px 0 20px"/>"#;
const P_TEXT: &str = r#"<p style="font-size:15px;line-height:24px;color:#171717;margin:0 0 16px;margin-top:0;margin-right:0;margin-bottom:16px;margin-left:0">"#;
const P_MUTED: &str = r#"<p style="font-size:13px;line-height:20px;color:#666666;margin:0 0 12px;margin-top:0;margin-right:0;margin-bottom:12px;margin-left:0">"#;
const P_MUTED_MORE: &str = r#"<p style="font-size:13px;line-height:20px;color:#666666;margin:0 0 12px;margin-top:20px;margin-right:0;margin-bottom:12px;margin-left:0">"#;
const P_FOOTER: &str = r#"<p style="font-size:12px;line-height:18px;color:#999999;margin:0 0 6px;margin-top:0;margin-right:0;margin-bottom:6px;margin-left:0">"#;
const P_CAPTION: &str = r#"<p style="font-size:14px;line-height:20px;color:#171717;margin:8px 0 0;margin-top:8px;margin-right:0;margin-bottom:0;margin-left:0">"#;
const P_DATE: &str = r#"<p style="font-size:12px;line-height:18px;color:#999999;margin:2px 0 0;margin-top:2px;margin-right:0;margin-bottom:0;margin-left:0">"#;
const IMG_STYLE: &str =
    "display:block;outline:none;border:none;text-decoration:none;border-radius:4px;width:100%;height:auto";
const LINK_IMG_STYLE: &str = "color:#067df7;text-decoration-line:none";
const LINK_CAPTION_STYLE: &str = "color:#171717;text-decoration-line:none;text-decoration:none";
const LINK_FOOTER_STYLE: &str = "color:#666666;text-decoration-line:none;text-decoration:underline";
const ROW_START: &str = r#"<table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="margin-top:20px"><tbody style="width:100%"><tr style="width:100%">"#;
const ROW_END: &str = "</tr></tbody></table>";
const COLUMN_EMPTY: &str = r#"<td data-id="__react-email-column" style="width:50%"></td>"#;

const PREVIEW_MAX_LENGTH: usize = 200;
/// The invisible characters react-email pads the preview with, so clients don't fill the
/// inbox preview line with the start of the body.
const PREVIEW_PAD: &str = "\u{A0}\u{200C}\u{200B}\u{200D}\u{200E}\u{200F}\u{FEFF}";

/// React's text and attribute escaping.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            c => out.push(c),
        }
    }
    out
}

/// `<title>` plus the hidden preview block, cut to 200 UTF-16 units like react-email's
/// `substring`. A cut through a surrogate pair leaves half a character, which became U+FFFD
/// when the string was encoded; that is reproduced.
fn preview(text: &str) -> (String, String) {
    let mut cut = js::utf16_prefix(text, PREVIEW_MAX_LENGTH).to_owned();
    let mut len = js::utf16_len(&cut);
    if len < PREVIEW_MAX_LENGTH && js::utf16_len(text) > len {
        cut.push('\u{FFFD}');
        len += 1;
    }
    let title = format!("<title>{}</title>", esc(&cut));
    let pad = if len < PREVIEW_MAX_LENGTH {
        format!("<div>{}</div>", PREVIEW_PAD.repeat(PREVIEW_MAX_LENGTH - len))
    } else {
        String::new()
    };
    let block = format!("{PREVIEW_START}{}{pad}</div>", esc(&cut));
    (title, block)
}

fn open(preview_text: &str, heading: &str) -> String {
    let (title, block) = preview(preview_text);
    format!("{HEAD_START}{title}</head>{BODY_START}{block}{CONTAINER_START}{}</h1>", esc(heading))
}

fn section(style: &str, inner: &str) -> String {
    format!("{SECTION_START}{style}{SECTION_MID}{inner}{SECTION_END}")
}

fn button(href: &str, label: &str) -> String {
    format!(r#"<a href="{}" style="{BUTTON_STYLE}" target="_blank">{BUTTON_PRE}{}{BUTTON_POST}"#, esc(href), esc(label))
}

fn link(href: &str, style: &str, inner: &str) -> String {
    format!(r#"<a href="{}" style="{style}" target="_blank">{inner}</a>"#, esc(href))
}

// ---- Plain text ---------------------------------------------------------------------------

/// html-to-text's whitespace handling: runs of these collapse to one space, ends trimmed.
fn collapse(s: &str) -> String {
    s.split([' ', '\t', '\r', '\n', '\u{c}', '\u{200B}']).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// An `<a>` in text form: "label href", just the href when the label is empty, and just
/// the label when it already spells the href (react-email's `hideLinkHrefIfSameAsText`).
fn text_link(label: &str, href: &str) -> String {
    let label = collapse(label);
    if label.is_empty() {
        href.to_owned()
    } else if label.replace(' ', "") == href {
        label
    } else {
        format!("{label} {href}")
    }
}

/// Blocks separated by blank lines, with the extra line html-to-text puts before an `<h1>`.
fn text_body(heading: &str, blocks: &[String]) -> String {
    let mut out = format!("{BRAND}\n\n\n{}", heading.to_uppercase());
    for b in blocks {
        out.push_str("\n\n");
        out.push_str(b);
    }
    out
}

// ---- Confirmation -------------------------------------------------------------------------

const CONFIRM_HEADING: &str = "Confirm your subscription";
const CONFIRM_PREVIEW: &str = "One click to get new photos from the map by email";
const CONFIRM_BODY: &str = "Someone, hopefully you, asked to get an email when new photos go up on the map. It comes at most once a week, and only when there's something new.";
const CONFIRM_TTL: &str = "This link works for 48 hours.";
const CONFIRM_FOOTER: &str = "If this wasn't you, ignore this email. Nothing happens until the link is clicked.";

pub fn confirm_email(confirm_url: &str) -> Email {
    let mut html = open(CONFIRM_PREVIEW, CONFIRM_HEADING);
    html.push_str(P_TEXT);
    html.push_str(&esc(CONFIRM_BODY));
    html.push_str("</p>");
    html.push_str(&section("margin:8px 0 24px", &button(confirm_url, "Confirm subscription")));
    let _ = write!(html, "{P_MUTED}{}</p>{HR}{P_FOOTER}{}</p>{END}", esc(CONFIRM_TTL), esc(CONFIRM_FOOTER));

    let text = text_body(
        CONFIRM_HEADING,
        &[
            CONFIRM_BODY.to_owned(),
            text_link("Confirm subscription", confirm_url),
            CONFIRM_TTL.to_owned(),
            "-".repeat(40),
            CONFIRM_FOOTER.to_owned(),
        ],
    );
    Email { html, text }
}

// ---- Digest -------------------------------------------------------------------------------

const DIGEST_FOOTER: &str =
    "You're getting this because you subscribed on the map. It only comes in weeks with new photos.";

fn photo_html(p: &DigestPhoto) -> String {
    let img = format!(
        r#"<img alt="{}" src="{}" style="{IMG_STYLE}"/>"#,
        esc(&format!("{}, open the photo", p.title)),
        esc(&p.image_url)
    );
    let mut out = link(&p.url, LINK_IMG_STYLE, &img);
    let _ = write!(out, "{P_CAPTION}{}</p>", link(&p.url, LINK_CAPTION_STYLE, &esc(&p.title)));
    if let Some(d) = &p.date {
        let _ = write!(out, "{P_DATE}{}</p>", esc(d));
    }
    out
}

fn photo_text(p: &DigestPhoto, blocks: &mut Vec<String>) {
    // The image link has no text of its own, so it prints as its bare URL.
    blocks.push(p.url.clone());
    blocks.push(text_link(&p.title, &p.url));
    if let Some(d) = &p.date {
        blocks.push(d.clone());
    }
}

pub fn digest_email(d: &Digest) -> Email {
    let total = 1 + d.rest.len() + d.more;
    let heading =
        if total == 1 { "A new photo on the map".to_owned() } else { format!("{total} new photos on the map") };
    let preview_text =
        if total > 1 { format!("{} and {} more", d.hero.title, total - 1) } else { d.hero.title.clone() };

    let mut html = open(&preview_text, &heading);
    html.push_str(&section("margin:20px 0 8px", &photo_html(d.hero)));
    for row in d.rest.chunks(2) {
        html.push_str(ROW_START);
        for (j, p) in row.iter().enumerate() {
            let padding = if j == 0 { "0 8px 0 0" } else { "0 0 0 8px" };
            let _ = write!(
                html,
                r#"<td data-id="__react-email-column" style="width:50%;vertical-align:top;padding:{padding}">{}</td>"#,
                photo_html(p)
            );
        }
        if row.len() == 1 {
            html.push_str(COLUMN_EMPTY);
        }
        html.push_str(ROW_END);
    }
    if d.more > 0 {
        // React separates adjacent text nodes with empty comments.
        let _ = write!(html, "{P_MUTED_MORE}…and <!-- -->{}<!-- --> more on the map.</p>", d.more);
    }
    let map_url = format!("{}/", d.base_url);
    let feed_url = format!("{}/feed.xml", d.base_url);
    html.push_str(&section("margin:28px 0 0;text-align:center", &button(&map_url, "Open the map")));
    let _ = write!(
        html,
        "{HR}{P_FOOTER}{}</p>{P_FOOTER}{} · {}</p>{END}",
        esc(DIGEST_FOOTER),
        link(d.unsubscribe_url, LINK_FOOTER_STYLE, "Unsubscribe"),
        link(&feed_url, LINK_FOOTER_STYLE, "RSS feed")
    );

    let mut blocks = Vec::new();
    photo_text(d.hero, &mut blocks);
    for p in d.rest {
        photo_text(p, &mut blocks);
    }
    if d.more > 0 {
        blocks.push(format!("…and {} more on the map.", d.more));
    }
    blocks.push(text_link("Open the map", &map_url));
    blocks.push("-".repeat(40));
    blocks.push(DIGEST_FOOTER.to_owned());
    blocks.push(format!("{} · {}", text_link("Unsubscribe", d.unsubscribe_url), text_link("RSS feed", &feed_url)));

    Email { html, text: text_body(&heading, &blocks) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/emails/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    fn photo(v: &Value) -> DigestPhoto {
        DigestPhoto {
            title: v["title"].as_str().unwrap().to_owned(),
            url: v["url"].as_str().unwrap().to_owned(),
            image_url: v["imageUrl"].as_str().unwrap().to_owned(),
            date: v["date"].as_str().map(str::to_owned),
        }
    }

    /// Every case rendered by the original React Email components must come out identical.
    #[test]
    fn matches_react_email_renders() {
        let cases: Vec<Value> = serde_json::from_str(&fixture("cases.json")).unwrap();
        assert!(cases.len() >= 10);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let props = &case["props"];
            let email = if case["kind"] == "confirm" {
                confirm_email(props["confirmUrl"].as_str().unwrap())
            } else {
                let hero = photo(&props["hero"]);
                let rest: Vec<DigestPhoto> = props["rest"].as_array().unwrap().iter().map(photo).collect();
                digest_email(&Digest {
                    base_url: props["baseUrl"].as_str().unwrap(),
                    hero: &hero,
                    rest: &rest,
                    more: props["more"].as_u64().unwrap() as usize,
                    unsubscribe_url: "{{{RESEND_UNSUBSCRIBE_URL}}}",
                })
            };
            assert_eq!(email.html, fixture(&format!("{name}.html")), "{name}.html");
            assert_eq!(email.text, fixture(&format!("{name}.txt")), "{name}.txt");
        }
    }
}
