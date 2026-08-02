// One-shot sessionStorage handoffs between Synitres surfaces. The writer stashes a listing id before
// routing; the reader consumes and clears it on arrival, then behaves like a normal visit. Kept here in
// shared/ so no feature module has to depend on another just to agree on the key string.

// Standalone /property/:id → /buy | /rentals: preselect that exact listing in the search + contact flow
// (written by PropertyDetailPage, read by RentalsPage).
export const SYNITRES_PRESELECT_LISTING_KEY = 'sybnb.v6.synitresPreselectListing'

// "My properties" inquiry count → /host/inquiries: open the owner inbox focused on that property
// (written by MyPropertiesPage, read by HostInquiriesPage).
export const SYNITRES_INQUIRY_FOCUS_LISTING_KEY = 'sybnb.v6.synitresInquiryFocusListing'
