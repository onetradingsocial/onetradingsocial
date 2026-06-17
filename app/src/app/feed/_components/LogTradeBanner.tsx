import { NewTradeButton } from '@/app/_components/NewTradeButton'

export function LogTradeBanner() {
  return (
    <div className="ts-logbanner">
      <span className="ts-logbanner-icon">⚡</span>
      <div className="ts-logbanner-text">
        <div className="t">Log a trade</div>
        <div className="s">Capture today&rsquo;s setup while it&rsquo;s fresh — every entry sharpens your edge.</div>
      </div>
      <NewTradeButton className="btn btn-onband" label="+ New Trade" />
    </div>
  )
}
