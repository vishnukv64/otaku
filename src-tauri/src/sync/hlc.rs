// Hybrid logical clock and merge rules. hlc = unix_ms << 16 | counter.
use std::sync::Mutex;

pub struct Hlc(Mutex<i64>);

impl Hlc {
    pub fn new(seed: i64) -> Self {
        Hlc(Mutex::new(seed))
    }

    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    /// Next stamp for a local event.
    pub fn tick(&self) -> i64 {
        let mut last = self.0.lock().unwrap();
        *last = (Self::now_ms() << 16).max(*last + 1);
        *last
    }

    /// Fold in a remote stamp so later local stamps order after it.
    pub fn observe(&self, remote: i64) {
        let mut last = self.0.lock().unwrap();
        *last = (*last).max(remote);
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    Apply,
    Skip,
}

/// Highest hlc wins; ties break on the larger device id. A repeat of the same
/// change (same hlc and device) is a no-op.
pub fn decide(local: Option<(i64, &str)>, incoming: (i64, &str)) -> Decision {
    match local {
        None => Decision::Apply,
        Some(l) if (incoming.0, incoming.1) > (l.0, l.1) => Decision::Apply,
        Some(_) => Decision::Skip,
    }
}

/// `completed` never reverts to false through a sync merge.
pub fn merge_completed(local: bool, incoming: bool) -> bool {
    local || incoming
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hlc_is_monotonic_and_orders_after_remote() {
        let c = Hlc::new(0);
        let (a, b) = (c.tick(), c.tick());
        assert!(b > a);
        let future = b + (5_000 << 16);
        c.observe(future);
        assert!(c.tick() > future);
    }

    #[test]
    fn newest_wins_ties_on_device() {
        assert_eq!(decide(None, (1, "a")), Decision::Apply);
        assert_eq!(decide(Some((5, "a")), (6, "a")), Decision::Apply);
        assert_eq!(decide(Some((6, "a")), (5, "z")), Decision::Skip);
        assert_eq!(decide(Some((5, "a")), (5, "b")), Decision::Apply);
        assert_eq!(decide(Some((5, "b")), (5, "a")), Decision::Skip);
        assert_eq!(decide(Some((5, "a")), (5, "a")), Decision::Skip);
    }

    #[test]
    fn completed_never_reverts() {
        assert!(merge_completed(true, false));
        assert!(merge_completed(false, true));
        assert!(!merge_completed(false, false));
    }
}
