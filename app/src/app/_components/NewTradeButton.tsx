'use client'

import { useTradeModal } from './TradeModalProvider'

export function NewTradeButton({ className = 'btn btn-primary btn-sm', label = '+ Log trade' }: { className?: string; label?: string }) {
  const { open } = useTradeModal()
  return <button type="button" className={className} onClick={open}>{label}</button>
}
