/**
 * The mark: ت, the first letter of ترجمان ("interpreter"), whose two dots are the two
 * people in the call, in their channel colours: the other side on the left, you on the
 * right, as in the columns of the conversation. The dots are rhombi, as a calligrapher's
 * pen draws them.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        className="brand__bowl"
        d="M3 37C4 44 13 49 30 49C45 49 55 45 60 38L60.5 18C60.3 16.6 58 16.2 57.2 17.6L56.2 34.5C52.5 39.5 43 42 30.5 42C17 42 8.5 41 3 37Z"
      />
      <path className="brand__them" d="M23.5 15 29 20.5 23.5 26 18 20.5Z" />
      <path className="brand__you" d="M35.5 15 41 20.5 35.5 26 30 20.5Z" />
    </svg>
  );
}
