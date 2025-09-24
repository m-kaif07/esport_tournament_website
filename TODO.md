# Tournament Listing Implementation

## Plan Implementation Steps:

### 1. Tournament Sorting & Data Attributes
- [x] Modify `fetchTournaments()` to sort tournaments by `dateTime` descending (newest to oldest)
- [x] Update `renderTournaments()` to add `data-tid` and `data-starttime` attributes to each card
- [x] Ensure cards render in chronological order (newest first)

### 2. Winner Badge Display
- [x] Add winner badge HTML structure to tournament cards when winner exists
- [x] Create CSS class `tournament-winner-badge` following existing dark theme
- [x] Display winner name from tournament data

### 3. Real-time Updates
- [x] Subscribe to `tournament.updated` channel via existing Socket.IO
- [x] Handle update messages with `{id, winner, status, startTime}`
- [x] Update existing cards or re-fetch and re-render when startTime changes
- [x] Implement fallback polling every 15 seconds (down from current 20s)

### 4. Admin Winner Notification
- [x] Add animation CSS for winner badge scale-up effect
- [x] Trigger animation when new winner is announced

### 5. CSS Integration
- [x] Add minimal CSS classes that follow existing dark theme
- [ ] Ensure mobile and desktop compatibility

## Files to Edit:
- `public/js/tournaments.js` - Main tournament functionality
- `public/css/styles.css` - Add winner badge styles
- `routes/tournaments.js` - Backend may need winner notification endpoint

## Testing Checklist:
- [ ] Test tournament sorting functionality
- [ ] Test winner badge display
- [ ] Test real-time updates via WebSocket
- [ ] Test fallback polling
- [ ] Test admin winner notification animation
- [ ] Verify mobile and desktop compatibility
