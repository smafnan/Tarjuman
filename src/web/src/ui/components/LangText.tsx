import type { CSSProperties, ReactNode } from 'react';

import { LANGUAGES, type LangCode } from '../../../../shared/languages';
import { cx } from '../lib/cx';
import { splitLatinRuns } from '../lib/scripts';

/** Class that switches Arabic-script text to the Urdu typeface chosen in the settings. */
export function scriptClass(lang: LangCode): string | false {
  return LANGUAGES[lang].script === 'Arab' && 'script-arab';
}

interface LangTextProps {
  lang: LangCode;
  as?: 'span' | 'p' | 'div';
  className?: string;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Text in a known language. Sets `lang` and the language's text direction so the right
 * font, shaping and alignment apply wherever the text appears. Latin words inside
 * Arabic-script text are set apart, so they take the caption face instead of the Nastaliq
 * face's own Latin.
 */
export function LangText({ lang, as: Tag = 'span', className, title, style, children }: LangTextProps) {
  const mixed = LANGUAGES[lang].script === 'Arab' && typeof children === 'string';
  return (
    <Tag
      lang={lang}
      dir={LANGUAGES[lang].dir}
      className={cx(scriptClass(lang), className)}
      title={title}
      style={style}
    >
      {mixed
        ? splitLatinRuns(children).map((run, index) =>
            run.latin ? (
              <span key={index} className="latin" dir="ltr">
                {run.text}
              </span>
            ) : (
              run.text
            ),
          )
        : children}
    </Tag>
  );
}
