# Changelog

All notable changes to TextMyAgent Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0-alpha.1] - 2026-04-06

### Added
- Initial release of TextMyAgent Desktop
- Native iMessage integration (no BlueBubbles required)
- Claude AI powered responses via Anthropic API
- Next.js dashboard for monitoring and configuration
- PermissionService for macOS privacy permission management
- Full Disk Access, Automation, and Contacts permission handling
- SQLite database for message history and settings
- API usage tracking and statistics
- Real-time log streaming
- System tray with quick controls
- Apple notarization support for distribution
- Hardened runtime for production security

### Technical
- Electron 39.x for macOS Sequoia compatibility
- better-sqlite3 for database operations
- node-mac-contacts for Contacts integration
- Secure API key storage in macOS Keychain
- 2-second polling interval for message detection
- Persistent lastRowId to prevent duplicate processing

## [Unreleased]

### Planned
- Auto-update functionality
- Conversation summarization
- User context/memory system
- Scheduled reminders
- Automation triggers
- Multi-language support
