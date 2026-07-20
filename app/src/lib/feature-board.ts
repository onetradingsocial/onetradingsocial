// Feature-request board shared constants (Sprint 3, row 26).
export const FR_STATUSES = ['under_review', 'planned', 'in_progress', 'released', 'not_planned'] as const
export type FrStatus = (typeof FR_STATUSES)[number]

export const FR_STATUS_LABELS: Record<FrStatus, string> = {
  under_review: 'Under review',
  planned: 'Planned',
  in_progress: 'In progress',
  released: 'Released',
  not_planned: 'Not planned',
}

export const FR_STATUS_CLASS: Record<FrStatus, string> = {
  under_review: 'vb-pending',
  planned: 'vb-statement',
  in_progress: 'vb-broker',
  released: 'at-live',
  not_planned: 'vb-failed',
}
