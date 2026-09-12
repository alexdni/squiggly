import unittest

from montage_registry import (
    get_all_known_eeg_channels,
    get_montage_channels,
    is_known_eeg_channel,
    normalize_channel_name,
)


class MontageRegistryTests(unittest.TestCase):
    def test_preserves_19_channel_montage(self):
        self.assertEqual(
            get_montage_channels('10-20-19'),
            [
                'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
                'T7', 'C3', 'Cz', 'C4', 'T8',
                'P7', 'P3', 'Pz', 'P4', 'P8',
                'O1', 'O2',
            ],
        )

    def test_supports_brainproducts_acticap_64(self):
        channels = get_montage_channels('brainproducts-acticap-64')
        self.assertEqual(len(channels), 64)
        self.assertEqual(len(set(channels)), 64)
        for channel in ['Fp1', 'AFz', 'F1', 'FCz', 'C1', 'CPz', 'P1', 'POz', 'Oz', 'Iz']:
            self.assertIn(channel, channels)
            self.assertIn(channel, get_all_known_eeg_channels())

    def test_normalizes_existing_aliases(self):
        self.assertEqual(normalize_channel_name('FP1'), 'Fp1')
        self.assertEqual(normalize_channel_name('EEG FP1-LE'), 'Fp1')
        self.assertEqual(normalize_channel_name('T3'), 'T7')
        self.assertEqual(normalize_channel_name('T4'), 'T8')
        self.assertEqual(normalize_channel_name('T5'), 'P7')
        self.assertEqual(normalize_channel_name('T6'), 'P8')
        self.assertEqual(normalize_channel_name('M1'), 'A1')
        self.assertEqual(normalize_channel_name('M2'), 'A2')

    def test_recognizes_synthetic_64_channel_set(self):
        for channel in get_montage_channels('brainproducts-acticap-64'):
            self.assertTrue(is_known_eeg_channel(channel), channel)


if __name__ == '__main__':
    unittest.main()
