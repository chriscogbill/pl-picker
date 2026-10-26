-- ============================================
-- Prem Picker (Last Man Standing) Database Schema
-- Database: premPicker
-- ============================================

-- App settings (current season, current gameweek)
CREATE TABLE IF NOT EXISTS app_settings (
    setting_id SERIAL PRIMARY KEY,
    setting_key VARCHAR(50) NOT NULL UNIQUE,
    setting_value VARCHAR(255) NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (setting_key, setting_value, description) VALUES
    ('current_season', '2024', 'Current PL season (e.g., 2024 for 2024/25)'),
    ('current_gameweek', '1', 'Current active gameweek')
ON CONFLICT (setting_key) DO NOTHING;

-- User profiles (lazy-synced from cogsAuth on each authenticated request)
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL,
    full_name VARCHAR(255),
    needs_password_setup BOOLEAN DEFAULT FALSE
);

-- Premier League teams (20 teams per season)
CREATE TABLE IF NOT EXISTS pl_teams (
    team_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(10) NOT NULL,
    api_id INTEGER,
    crest_url TEXT,
    season INTEGER NOT NULL DEFAULT 2024,
    UNIQUE(short_name, season)
);

-- PL fixtures (one row per match)
CREATE TABLE IF NOT EXISTS pl_fixtures (
    fixture_id SERIAL PRIMARY KEY,
    season INTEGER NOT NULL,
    gameweek INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL REFERENCES pl_teams(team_id),
    away_team_id INTEGER NOT NULL REFERENCES pl_teams(team_id),
    match_date TIMESTAMPTZ,
    home_score INTEGER,
    away_score INTEGER,
    status VARCHAR(20) DEFAULT 'scheduled',
    api_match_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season, gameweek, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_fixtures_season_gw ON pl_fixtures(season, gameweek);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON pl_fixtures(status);

-- Games (Last Man Standing leagues)
CREATE TABLE IF NOT EXISTS games (
    game_id SERIAL PRIMARY KEY,
    game_name VARCHAR(255) NOT NULL,
    season INTEGER NOT NULL,
    created_by_email VARCHAR(255) NOT NULL,
    admin_email VARCHAR(255) NOT NULL,
    invite_code VARCHAR(8) UNIQUE,
    start_gameweek INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) DEFAULT 'open',
    winner_player_id INTEGER,
    is_draw BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_games_season ON games(season);
CREATE INDEX IF NOT EXISTS idx_games_invite ON games(invite_code);

-- Game players (who's in each game)
CREATE TABLE IF NOT EXISTS game_players (
    player_id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'alive',
    eliminated_gameweek INTEGER,
    eliminated_pick_id INTEGER,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_status ON game_players(status);

-- Picks (one pick per player per gameweek)
CREATE TABLE IF NOT EXISTS picks (
    pick_id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    game_player_id INTEGER NOT NULL REFERENCES game_players(player_id) ON DELETE CASCADE,
    gameweek INTEGER NOT NULL,
    pl_team_id INTEGER NOT NULL REFERENCES pl_teams(team_id),
    result VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, game_player_id, gameweek)
);

CREATE INDEX IF NOT EXISTS idx_picks_game_gw ON picks(game_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_picks_player ON picks(game_player_id);

-- Add FK for winner_player_id and eliminated_pick_id after tables exist
ALTER TABLE games
    DROP CONSTRAINT IF EXISTS fk_winner_player;
ALTER TABLE games
    ADD CONSTRAINT fk_winner_player
    FOREIGN KEY (winner_player_id) REFERENCES game_players(player_id);

ALTER TABLE game_players
    DROP CONSTRAINT IF EXISTS fk_eliminated_pick;
ALTER TABLE game_players
    ADD CONSTRAINT fk_eliminated_pick
    FOREIGN KEY (eliminated_pick_id) REFERENCES picks(pick_id);
