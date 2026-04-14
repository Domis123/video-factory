ALTER TABLE asset_segments ADD COLUMN segment_type TEXT
  CHECK (segment_type IN (
    'setup','exercise','transition','hold','cooldown',
    'talking-head','b-roll','unusable'
  ));
CREATE INDEX asset_segments_type_idx ON asset_segments(segment_type);
