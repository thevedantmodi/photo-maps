import { render } from 'react-email';

import ConfirmEmail from './ConfirmEmail';
import DigestEmail from './DigestEmail';

type Props<C> = C extends (props: infer P) => unknown ? P : never;

async function toEmail(message: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(message), render(message, { plainText: true })]);
  return { html, text };
}

export const renderConfirmEmail = (props: Props<typeof ConfirmEmail>) =>
  toEmail(<ConfirmEmail {...props} />);

export const renderDigestEmail = (props: Props<typeof DigestEmail>) =>
  toEmail(<DigestEmail {...props} />);
