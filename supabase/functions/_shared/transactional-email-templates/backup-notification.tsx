import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Section, Row, Column, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Belay Reports"

interface BackupNotificationProps {
  timestamp?: string
  fileSize?: string
  totalRows?: number
  tableCounts?: Record<string, number>
  downloadUrl?: string
  tableCount?: number
  denormalizedReports?: number
  pdfsGenerated?: number
  pdfsNoSource?: number
}

const BackupNotificationEmail = ({
  timestamp = 'Wednesday, April 2, 2026 at 8:00 PM ET',
  fileSize = '2.4 MB',
  totalRows = 12500,
  tableCounts = {},
  downloadUrl = '#',
  tableCount = 0,
  denormalizedReports = 0,
  pdfsGenerated = 0,
  pdfsNoSource = 0,
}: BackupNotificationProps) => {
  const tableEntries = Object.entries(tableCounts).sort(([, a], [, b]) => b - a)
  const displayTableCount = tableCount || Object.keys(tableCounts).length

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>✅ Daily Backup Complete — {denormalizedReports} reports — {timestamp}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerTitle}>✅ Daily Backup Complete</Heading>
            <Text style={headerSubtitle}>{timestamp}</Text>
          </Section>

          {/* Stats */}
          <Section style={statsContainer}>
            <Row>
              <Column style={statBox}>
                <Text style={statValue}>{totalRows.toLocaleString()}</Text>
                <Text style={statLabel}>Total Rows</Text>
              </Column>
              <Column style={statBoxBlue}>
                <Text style={statValueBlue}>{fileSize}</Text>
                <Text style={statLabel}>JSON Size</Text>
              </Column>
              <Column style={statBoxYellow}>
                <Text style={statValueYellow}>{displayTableCount.toString()}</Text>
                <Text style={statLabel}>Tables</Text>
              </Column>
            </Row>
          </Section>

          {/* Reports & PDFs Stats */}
          <Section style={reportsSection}>
            <Row>
              <Column style={reportStatBox}>
                <Text style={reportStatValue}>{denormalizedReports.toString()}</Text>
                <Text style={statLabel}>JSON Reports</Text>
              </Column>
              <Column style={{ ...reportStatBox, backgroundColor: '#fef3c7' }}>
                <Text style={{ ...reportStatValue, color: '#92400e' }}>{pdfsGenerated.toString()}</Text>
                <Text style={statLabel}>PDFs Copied</Text>
              </Column>
            </Row>
          </Section>

          {/* Download Button */}
          <Section style={downloadSection}>
            <Button style={downloadButton} href={downloadUrl}>
              Download Full Archive
            </Button>
            <Text style={downloadNote}>
              Link valid for 7 days • Contains backup.json.gz + {denormalizedReports} denormalized report files
            </Text>
          </Section>

          {/* Table Breakdown */}
          {tableEntries.length > 0 && (
            <Section style={tableSection}>
              <Heading as="h3" style={tableHeading}>Table Breakdown</Heading>
              {tableEntries.map(([table, count]) => (
                <Row key={table} style={tableRow}>
                  <Column style={tableNameCol}>
                    <Text style={tableName}>{table}</Text>
                  </Column>
                  <Column style={tableCountCol}>
                    <Text style={tableCountStyle}>{count.toLocaleString()}</Text>
                  </Column>
                </Row>
              ))}
            </Section>
          )}

          <Hr style={divider} />

          {/* Footer */}
          <Text style={footer}>{SITE_NAME} — Automated Daily Backup</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BackupNotificationEmail,
  subject: (data: Record<string, any>) => {
    return `Belay Reports Daily Backup — ${data.timestamp || 'Complete'}`
  },
  displayName: 'Daily backup notification',
  previewData: {
    timestamp: 'Wednesday, April 2, 2026 at 8:00 PM ET',
    fileSize: '2.4 MB',
    totalRows: 12500,
    tableCount: 35,
    tableCounts: { profiles: 25, inspections: 340, trainings: 120 },
    downloadUrl: 'https://example.com/download',
    denormalizedReports: 485,
    pdfsGenerated: 24,
  },
} satisfies TemplateEntry

// Styles
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '0', maxWidth: '600px', margin: '0 auto' }
const header = { backgroundColor: '#1a365d', padding: '24px', textAlign: 'center' as const }
const headerTitle = { color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: '0' }
const headerSubtitle = { color: 'rgba(255,255,255,0.9)', fontSize: '14px', margin: '8px 0 0' }
const statsContainer = { padding: '24px 16px 8px' }
const statBox = { backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '16px', textAlign: 'center' as const, width: '33%' }
const statBoxBlue = { backgroundColor: '#eff6ff', borderRadius: '8px', padding: '16px', textAlign: 'center' as const, width: '33%' }
const statBoxYellow = { backgroundColor: '#fef3c7', borderRadius: '8px', padding: '16px', textAlign: 'center' as const, width: '33%' }
const statValue = { fontSize: '24px', fontWeight: 'bold', color: '#166534', margin: '0' }
const statValueBlue = { fontSize: '24px', fontWeight: 'bold', color: '#1e40af', margin: '0' }
const statValueYellow = { fontSize: '24px', fontWeight: 'bold', color: '#92400e', margin: '0' }
const statLabel = { fontSize: '12px', color: '#6b7280', margin: '4px 0 0' }
const reportsSection = { padding: '8px 16px 24px' }
const reportStatBox = { backgroundColor: '#f5f3ff', borderRadius: '8px', padding: '16px', textAlign: 'center' as const, width: '50%' }
const reportStatValue = { fontSize: '24px', fontWeight: 'bold', color: '#6d28d9', margin: '0' }
const downloadSection = { textAlign: 'center' as const, padding: '0 24px 24px' }
const downloadButton = {
  backgroundColor: '#1a365d', color: '#ffffff', padding: '12px 32px',
  borderRadius: '6px', textDecoration: 'none', fontWeight: 'bold', fontSize: '14px',
  display: 'inline-block',
}
const downloadNote = { fontSize: '12px', color: '#6b7280', margin: '8px 0 0' }
const tableSection = { padding: '0 24px 24px' }
const tableHeading = { fontSize: '14px', color: '#374151', margin: '0 0 12px' }
const tableRow = { borderBottom: '1px solid #e5e7eb' }
const tableNameCol = { padding: '6px 0', width: '70%' }
const tableCountCol = { padding: '6px 0', width: '30%', textAlign: 'right' as const }
const tableName = { fontSize: '13px', color: '#374151', margin: '0' }
const tableCountStyle = { fontSize: '13px', color: '#374151', margin: '0' }
const divider = { borderColor: '#e5e7eb', margin: '0' }
const footer = { fontSize: '12px', color: '#6b7280', textAlign: 'center' as const, padding: '16px', margin: '0' }
