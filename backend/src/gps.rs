//! Coordinate validation shared by the routes (mirrors `src/lib/gps.ts` and
//! `src/lib/customPlaces.ts` in the frontend, which keep their own copies for the browser).

use serde_json::Value;

use crate::js;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coordinates {
    pub latitude: f64,
    pub longitude: f64,
}

pub fn is_valid_lat(n: f64) -> bool {
    n.is_finite() && (-90.0..=90.0).contains(&n)
}

pub fn is_valid_lon(n: f64) -> bool {
    n.is_finite() && (-180.0..=180.0).contains(&n)
}

/// Bounds for an admin-entered custom place radius, in km.
pub const MIN_RADIUS_KM: f64 = 0.1;
pub const MAX_RADIUS_KM: f64 = 500.0;

pub fn is_valid_radius(n: f64) -> bool {
    n.is_finite() && (MIN_RADIUS_KM..=MAX_RADIUS_KM).contains(&n)
}

/// `coercePair`: a lat/lon pair supplied by a client, or None when either half is unusable.
pub fn coerce_pair(lat: Option<&Value>, lon: Option<&Value>) -> Option<Coordinates> {
    if js::is_blank(lat) || js::is_blank(lon) {
        return None;
    }
    let latitude = js::to_number(lat?);
    let longitude = js::to_number(lon?);
    if !is_valid_lat(latitude) || !is_valid_lon(longitude) {
        return None;
    }
    Some(Coordinates { latitude, longitude })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairs() {
        let p = |a: Value, b: Value| coerce_pair(Some(&a), Some(&b));
        assert_eq!(p(json!(1.5), json!("2.5")), Some(Coordinates { latitude: 1.5, longitude: 2.5 }));
        assert_eq!(p(json!(""), json!(2)), None);
        assert_eq!(p(json!(null), json!(2)), None);
        assert_eq!(p(json!(91), json!(2)), None);
        assert_eq!(p(json!(0), json!(-180)), Some(Coordinates { latitude: 0.0, longitude: -180.0 }));
        assert_eq!(coerce_pair(None, Some(&json!(1))), None);
    }

    #[test]
    fn radius() {
        assert!(is_valid_radius(0.1));
        assert!(is_valid_radius(500.0));
        assert!(!is_valid_radius(0.0));
        assert!(!is_valid_radius(f64::NAN));
        assert!(!is_valid_radius(500.01));
    }
}
