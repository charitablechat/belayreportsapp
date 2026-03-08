

## Fix: Add User Feedback to Contact Developer Sheet

### Problem
The `ContactDeveloperSheet.tsx` component (opened from the profile dropdown) has no toast notifications. The webhook fires successfully (confirmed in logs), but the user gets zero visual feedback — no success message, no error message, no validation warnings. This makes it appear broken.

Compare with `ContactDeveloper.tsx` (the FAB version) which correctly shows `toast.success` and `toast.error`.

### Fix
Add toast notifications to `ContactDeveloperSheet.tsx` for:
1. **Success**: "Message sent successfully!" after webhook completes
2. **Error**: "Failed to send message. Please try again." on failure
3. **Validation**: Missing fields, message too long, offline warnings
4. **File upload errors**: Size limit exceeded

Single file change: `src/components/ContactDeveloperSheet.tsx` — import `toast` from sonner and add toast calls matching the pattern in `ContactDeveloper.tsx`.

