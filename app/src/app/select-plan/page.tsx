import { redirect } from 'next/navigation'

// The plan picker was replaced by the 14-day Pro trial welcome screen. Kept as
// a redirect so stale tabs and old Stripe cancel URLs still land somewhere.
export default function SelectPlanPage() {
  redirect('/welcome')
}
