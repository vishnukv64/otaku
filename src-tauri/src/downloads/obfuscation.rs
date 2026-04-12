// XOR Obfuscation for Downloaded Video Files
//
// Uses a static 32-byte key to XOR-transform bytes during download (encrypt)
// and during playback (decrypt). XOR is symmetric — the same operation works
// for both directions. The key is position-aware to support Range requests.

/// Static 32-byte obfuscation key embedded in the binary.
const OBFUSCATION_KEY: [u8; 32] = [
    0x4F, 0x54, 0x41, 0x4B, 0x55, 0x5F, 0x50, 0x52,
    0x4F, 0x54, 0x45, 0x43, 0x54, 0x5F, 0x56, 0x31,
    0xA7, 0x3B, 0xC8, 0x19, 0xE2, 0x6D, 0xF4, 0x58,
    0x91, 0x0A, 0xB3, 0x2C, 0xD5, 0x4E, 0x77, 0x80,
];

/// XOR obfuscate/deobfuscate bytes at a given file offset.
/// Works for both encryption (during download) and decryption (during playback).
pub fn xor_transform(data: &mut [u8], file_offset: u64) {
    let key_len = OBFUSCATION_KEY.len();
    for (i, byte) in data.iter_mut().enumerate() {
        *byte ^= OBFUSCATION_KEY[(file_offset as usize + i) % key_len];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let original = b"Hello, this is a test of XOR obfuscation!".to_vec();
        let mut encrypted = original.clone();
        xor_transform(&mut encrypted, 0);
        // Encrypted data should differ from original
        assert_ne!(encrypted, original);
        // Decrypt
        xor_transform(&mut encrypted, 0);
        assert_eq!(encrypted, original);
    }

    #[test]
    fn test_position_aware() {
        let original = b"Same data at different offsets".to_vec();
        let mut at_zero = original.clone();
        let mut at_ten = original.clone();
        xor_transform(&mut at_zero, 0);
        xor_transform(&mut at_ten, 10);
        // Same data at different offsets should produce different results
        assert_ne!(at_zero, at_ten);
        // Both should roundtrip correctly
        xor_transform(&mut at_zero, 0);
        xor_transform(&mut at_ten, 10);
        assert_eq!(at_zero, original);
        assert_eq!(at_ten, original);
    }
}
