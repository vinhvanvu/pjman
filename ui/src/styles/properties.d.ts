// The CSS custom properties components set inline, typed so a style object needs no cast.
import 'react';

declare module 'react' {
  interface CSSProperties {
    /** The lane colour a row or a page draws its rail and markers in. */
    '--lane'?: string;
  }
}
