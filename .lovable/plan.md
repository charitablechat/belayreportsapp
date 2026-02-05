
# Plan: Send Report via Email (Embedded HTML Content) - v2.2.91

## Overview

This plan implements the ability to send the **full HTML report directly embedded in an email** for all three report types (Inspection, Training, Daily Assessment). The recipient receives the complete report in their email inbox without needing to download files or click links.

## Current State

- **Training Form**: Has an email dialog that sends a PDF download link (via `send-training-pdf-email`)
- **Inspection Form**: No email sharing capability
- **Daily Assessment Form**: No email sharing capability
- **HtmlReportViewer**: Has Download and Web Share API buttons, but no direct email

## Target Implementation

Add an **"Email Report"** button to the `HtmlReportViewer` component header that:
1. Opens an email dialog (recipient email, optional name, optional message)
2. Sends the full HTML report embedded in the email body via a new edge function

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    HtmlReportViewer                             │
│  [📧 Email] [📥 Download] [📤 Share] [✕ Close]                  │
│─────────────────────────────────────────────────────────────────│
│                   [Report Content iframe]                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (Click Email)
┌─────────────────────────────────────────────────────────────────┐
│              EmailReportDialog                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Recipient Email: [________________________] *            │   │
│  │ Recipient Name:  [________________________]              │   │
│  │ Message:         [                        ]              │   │
│  │                  [________________________]              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                        [Cancel] [Send Email]                    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (Send)
┌─────────────────────────────────────────────────────────────────┐
│            Edge Function: send-report-email                     │
│  - Receives: html, recipientEmail, recipientName, message,      │
│              reportType, title                                  │
│  - Uses Resend API to send email with HTML body                 │
│  - Rate limited: 10 emails per user per hour                    │
└─────────────────────────────────────────────────────────────────┘
```

## Technical Details

### Phase 1: Create Edge Function

**New File**: `supabase/functions/send-report-email/index.ts`

This edge function:
- Accepts the full HTML report content, recipient details, and report metadata
- Wraps the HTML in a professional email template with header/footer
- Uses Resend API to send the email
- Rate limits to 10 emails per user per hour
- Validates email format and sanitizes HTML

**Email Template Structure:**
```html
<!-- Email wrapper with Rope Works branding -->
<div style="header styling...">
  <h1>[Report Type] Report</h1>
  <p>Organization | Date</p>
</div>

<!-- Optional personal message -->
<div style="message box styling...">
  Message from [Sender]: [message]
</div>

<!-- Full HTML report content embedded -->
<div style="report container...">
  [Full HTML Report Content]
</div>

<!-- Footer with disclaimer -->
<div style="footer styling...">
  Rope Works Inc. - Professional Services
  <small>ACCT Accredited Vendor</small>
</div>
```

### Phase 2: Create Reusable Email Dialog Component

**New File**: `src/components/EmailReportDialog.tsx`

A reusable dialog component that:
- Collects recipient email (required), name (optional), and message (optional)
- Validates email format before sending
- Shows loading state during send
- Handles rate limiting gracefully
- Can be used from any report viewer

**Props Interface:**
```typescript
interface EmailReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  html: string;
  reportType: 'inspection' | 'training' | 'daily_assessment';
  title: string;
  organization?: string;
  date?: string;
}
```

### Phase 3: Update HtmlReportViewer

**Modified File**: `src/components/HtmlReportViewer.tsx`

Add:
- Email button (envelope icon) in the header action bar
- State for email dialog open/close
- Pass necessary props to EmailReportDialog
- New required props: `reportType`, `organization`, `date`

**Updated Props Interface:**
```typescript
interface HtmlReportViewerProps {
  html: string;
  title: string;
  filename: string;
  isOpen: boolean;
  onClose: () => void;
  // New props for email feature
  reportType?: 'inspection' | 'training' | 'daily_assessment';
  organization?: string;
  date?: string;
}
```

### Phase 4: Update Form Pages

Pass the new props when rendering HtmlReportViewer:

**InspectionForm.tsx:**
```typescript
<HtmlReportViewer
  html={reportHtml}
  title={`Inspection Report - ${inspection?.organization}`}
  filename={...}
  isOpen={htmlViewerOpen}
  onClose={() => setHtmlViewerOpen(false)}
  reportType="inspection"
  organization={inspection?.organization}
  date={inspection?.inspection_date}
/>
```

**TrainingForm.tsx:**
```typescript
<HtmlReportViewer
  html={reportHtml}
  title={`Training Report - ${training?.organization}`}
  filename={...}
  isOpen={htmlViewerOpen}
  onClose={() => setHtmlViewerOpen(false)}
  reportType="training"
  organization={training?.organization}
  date={training?.start_date}
/>
```

**DailyAssessmentForm.tsx:**
```typescript
<HtmlReportViewer
  html={reportHtml}
  title={`Daily Assessment - ${assessment?.site}`}
  filename={...}
  isOpen={viewerOpen}
  onClose={() => setViewerOpen(false)}
  reportType="daily_assessment"
  organization={assessment?.site}
  date={assessment?.assessment_date}
/>
```

## UI Design: Minimal Brutalism

The Email button in the HtmlReportViewer header follows Minimal Brutalism:
- High contrast icon (envelope) on solid background
- Bold 2px border
- Square corners with minimal rounding
- Clear hover state (invert colors)
- 44px minimum touch target for mobile

```css
.email-button {
  height: 40px;
  width: 40px;
  border: 2px solid currentColor;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 100ms;
}
.email-button:hover {
  background: foreground;
  color: background;
}
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/send-report-email/index.ts` | Create | Edge function to send HTML report via Resend |
| `src/components/EmailReportDialog.tsx` | Create | Reusable email dialog component |
| `src/components/HtmlReportViewer.tsx` | Modify | Add email button and dialog integration |
| `src/pages/InspectionForm.tsx` | Modify | Pass reportType, organization, date props |
| `src/pages/TrainingForm.tsx` | Modify | Pass reportType, organization, date props |
| `src/pages/DailyAssessmentForm.tsx` | Modify | Pass reportType, organization, date props |
| `vite.config.ts` | Modify | Version bump to 2.2.91 |

## Security Considerations

1. **Authentication Required**: Edge function validates auth token
2. **Rate Limiting**: 10 emails per user per hour (prevents abuse)
3. **Email Validation**: Server-side regex validation
4. **HTML Sanitization**: The HTML is already generated server-side by trusted edge functions
5. **No Secrets Exposed**: Report content is self-contained, no backend URLs or API keys

## Rate Limiting Strategy

Using the existing `rate-limiter.ts` pattern:
- Key: `email:report:${user.id}`
- Limit: 10 requests per hour
- Returns 429 with retry-after header when exceeded

## Email Provider

Uses the existing `RESEND_API_KEY` (already configured in secrets) for sending emails.

**From address**: `Rope Works Inc. <reports@resend.dev>` (Resend's default domain)

## Edge Cases Handled

1. **Large HTML Content**: Resend supports up to 40KB email body; HTML reports are typically 20-30KB
2. **Images in Report**: Logos are embedded as base64 data URIs (already in the HTML)
3. **Offline Mode**: Email button disabled when offline (requires network)
4. **Missing Props**: Email button hidden if reportType prop not provided (graceful degradation)

## Testing Checklist

1. Generate Inspection report - Click Email - Send to test address - Verify full report received
2. Generate Training report - Click Email - Send to test address - Verify full report received
3. Generate Daily Assessment - Click Email - Send to test address - Verify full report received
4. Test rate limiting: Send 11 emails quickly - Verify 11th is blocked with retry message
5. Test offline: Go airplane mode - Verify Email button is disabled
6. Test mobile: Open report in PWA - Verify Email dialog works on touch devices
7. Verify email renders correctly in Gmail, Outlook, Apple Mail

## Version Update

```typescript
const APP_VERSION = "2.2.91";
```
