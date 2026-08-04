import type { ChangeEvent } from 'react'
import type { ContentLanguageCode, LanguageAvailability } from '../lib/contentLanguages'

export type LanguageSelectOption = {
  value: ContentLanguageCode
  label: string
  availability: LanguageAvailability
}

export function LanguageSelect({
  label,
  value,
  options,
  statusLabel,
  onChange,
}: {
  label: string
  value: ContentLanguageCode
  options: LanguageSelectOption[]
  statusLabel: (availability: LanguageAvailability) => string
  onChange: (value: ContentLanguageCode) => void
}) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as ContentLanguageCode)
  }

  return (
    <label className="language-select">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={handleChange}>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.availability !== 'available'}
          >
            {option.label} · {statusLabel(option.availability)}
          </option>
        ))}
      </select>
    </label>
  )
}
