import type { CsvExportType, Page, QueueReport, ReportSummary, RevenueReport, Ticket, UtilizationReport } from '@/types/api'
import { api } from './client'

export interface Range {
  from: string
  to: string
}

export const reportsApi = {
  summary: (r: Range) => api<ReportSummary>('GET', '/admin/reports/summary', undefined, { query: { ...r } }),
  revenue: (r: Range) => api<RevenueReport>('GET', '/admin/reports/revenue', undefined, { query: { ...r } }),
  utilization: (r: Range) => api<UtilizationReport>('GET', '/admin/reports/utilization', undefined, { query: { ...r } }),
  queue: (r: Range) => api<QueueReport>('GET', '/admin/reports/queue', undefined, { query: { ...r } }),
  students: (r: Range & { q?: string; page?: number }) =>
    api<Page<Ticket>>('GET', '/admin/reports/students', undefined, { query: { ...r } }),
  /** Returns CSV text. The server writes EXPORT_DOWNLOADED to the audit log. */
  exportCsv: (type: CsvExportType, r: Range) =>
    api<string>('GET', '/admin/reports/export', undefined, { query: { type, ...r } }),
}
