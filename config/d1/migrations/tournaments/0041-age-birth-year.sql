-- The birth year an account gave at its age check, which the 18+ rules read
-- (shared/accounts/age.ts). `birth_date` stays the player profile's, which
-- the account edits, so editing it no longer moves the account past them.
-- An account already made takes the year its profile holds now: the age
-- check wrote that year, and only a profile edit since could have changed
-- it. An account without one (its profile cleared, or no age check passed
-- yet) is left NULL, which the 18+ rules refuse. Run once, after 0040.
ALTER TABLE users ADD COLUMN age_birth_year INTEGER;
UPDATE users SET age_birth_year = CAST(substr(birth_date, -4) AS INTEGER)
 WHERE age_checked_at IS NOT NULL AND birth_date GLOB '*/*/[0-9][0-9][0-9][0-9]';
