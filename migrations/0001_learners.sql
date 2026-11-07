CREATE TABLE learners (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE progress (
  learner_id TEXT NOT NULL REFERENCES learners(id),
  class_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  streak INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  last_reviewed_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, class_id, card_id)
);
CREATE TABLE reviews (
  learner_id TEXT NOT NULL REFERENCES learners(id),
  event_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  PRIMARY KEY (learner_id, event_id)
);
CREATE TABLE learner_attempts (
  address_hash TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (address_hash, hour)
);
CREATE INDEX learner_attempts_hour ON learner_attempts(hour);
