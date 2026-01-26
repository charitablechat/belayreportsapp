

## Add "Change Password" Feature to Profile Page

This plan adds a secure password change section to the existing Profile Settings page, allowing users to update their password without needing to enter their current/old password.

---

### UI Design

The Change Password section will be added as a **separate Card** below the existing "Personal Information" card, maintaining visual consistency with the current design.

```text
┌─────────────────────────────────────────────────────────────┐
│  Personal Information                                        │
│  Update your profile information and avatar                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  [Avatar] [Email] [First Name] [Last Name] [ACCT#]      ││
│  │  [Cancel] [Save Changes]                                 ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Security                                                    │
│  Update your account password                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  New Password         [••••••••••••••]                  ││
│  │  Confirm Password     [••••••••••••••]                  ││
│  │                                                          ││
│  │  Password Requirements:                                  ││
│  │  ✓ At least 8 characters                                ││
│  │  ✓ Passwords match                                      ││
│  │                                                          ││
│  │                              [Update Password]           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

### Input Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| New Password | `password` | Yes | The new password the user wants to set |
| Confirm New Password | `password` | Yes | Confirmation to prevent typos |

---

### Client-Side Validation Rules

1. **Minimum Length**: Password must be at least 8 characters
2. **Maximum Length**: Password must not exceed 72 characters (bcrypt limit)
3. **Match Validation**: "Confirm Password" must exactly match "New Password"
4. **Required Fields**: Both fields must be filled before submission
5. **Real-time Feedback**: Show validation status as user types

---

### Implementation Details

**File to Modify:** `src/pages/Profile.tsx`

1. **Add new state variables:**
   - `newPassword` - stores the new password input
   - `confirmPassword` - stores the confirmation input
   - `changingPassword` - loading state for the update operation
   - `passwordError` - validation error message

2. **Add password validation function:**
   - Check minimum length (8 characters)
   - Check maximum length (72 characters)
   - Check if passwords match
   - Return appropriate error messages

3. **Add password change handler:**
   - Validate inputs before submission
   - Call `supabase.auth.updateUser({ password: newPassword })`
   - Show success/error toast notifications
   - Clear password fields on success
   - Trigger haptic feedback

4. **Add new UI Card section:**
   - Title: "Security"
   - Description: "Update your account password"
   - Two password input fields with labels
   - Real-time validation feedback showing requirements
   - "Update Password" button (separate from profile save)

5. **Import additional icon:**
   - Import `Lock` icon from lucide-react for the section

---

### User Experience Flow

1. User scrolls to "Security" section on Profile page
2. User enters new password in first field
3. Real-time validation shows if length requirement is met
4. User enters same password in confirmation field
5. Real-time validation shows if passwords match
6. User clicks "Update Password" button
7. System validates and updates password
8. Success toast appears: "Password Updated - Your password has been changed successfully"
9. Both password fields are cleared

---

### Error Handling

| Scenario | User Feedback |
|----------|---------------|
| Password too short | "Password must be at least 8 characters" |
| Password too long | "Password must not exceed 72 characters" |
| Passwords don't match | "Passwords do not match" |
| Network/API error | Toast with error message from server |
| Success | Green success toast with confirmation |

---

### Security Considerations

- Password fields use `type="password"` to mask input
- Passwords are never logged or stored in state after successful update
- Fields are cleared after successful password change
- The authentication system handles password hashing server-side
- No current password required (per specification) - relies on active session

