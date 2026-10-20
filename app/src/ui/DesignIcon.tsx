const icons = {
  users: ['bd2ca.svg', '1fdf4.svg'], shield: ['8c895.svg', '74073.svg'],
  usersInactive: ['956f3.svg', 'd256f.svg'], shieldActive: ['b2f56.svg', '5f222.svg'],
  breadcrumb: ['59699.svg'], logout: ['de6df.svg'], plus: ['68eab.svg'],
  search: ['72a2b.svg'], chevron: ['edb67.svg', '37a1b.svg'],
  sliders: ['39e83.svg'], back: ['0c6e5.svg'], info: ['b238b.svg'], check: ['3eae4.svg'],
} as const

export default function DesignIcon({ name }: { name: keyof typeof icons }) {
  const files: readonly string[] = icons[name]
  return <picture className="design-icon" aria-hidden="true">
    {files[1] && <source media="(max-width: 980px)" srcSet={`/design/${files[1]}`} />}
    <img src={`/design/${files[0]}`} alt="" />
  </picture>
}
