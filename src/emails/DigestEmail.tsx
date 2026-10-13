import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email';

import { EMAIL, s } from './theme';

export interface DigestPhoto {
  title: string;
  url: string;
  imageUrl: string;
  /** Formatted date taken, if known. */
  date: string | null;
}

interface DigestEmailProps {
  baseUrl: string;
  /** Lead photo, shown full width from the large rendition. */
  hero: DigestPhoto;
  /** The rest, two to a row from thumbnails. */
  rest: DigestPhoto[];
  /** New photos beyond the ones shown. */
  more: number;
  /** Resend fills this per recipient when the broadcast sends. */
  unsubscribeUrl: string;
}

const caption = { color: EMAIL.text, fontSize: '14px', lineHeight: '20px', margin: '8px 0 0' };
const date = { color: EMAIL.faint, fontSize: '12px', lineHeight: '18px', margin: '2px 0 0' };
const photo = { borderRadius: '4px', display: 'block', width: '100%', height: 'auto' }; // radius-xs

function PhotoCaption({ p }: { p: DigestPhoto }) {
  return (
    <>
      <Text style={caption}>
        <Link href={p.url} style={{ color: EMAIL.text, textDecoration: 'none' }}>
          {p.title}
        </Link>
      </Text>
      {p.date && <Text style={date}>{p.date}</Text>}
    </>
  );
}

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

export default function DigestEmail({ baseUrl, hero, rest, more, unsubscribeUrl }: DigestEmailProps) {
  const total = 1 + rest.length + more;
  return (
    <Html lang="en">
      <Head />
      <Body style={s.body}>
        <Preview>{`${hero.title}${total > 1 ? ` and ${total - 1} more` : ''}`}</Preview>
        <Container style={s.container}>
          <Text style={s.brand}>Photos by Vedant Modi</Text>
          <Heading as="h1" style={s.h1}>
            {total === 1 ? 'A new photo on the map' : `${total} new photos on the map`}
          </Heading>

          <Section style={{ margin: '20px 0 8px' }}>
            <Link href={hero.url}>
              <Img src={hero.imageUrl} alt={`${hero.title}, open the photo`} style={photo} />
            </Link>
            <PhotoCaption p={hero} />
          </Section>

          {pairs(rest).map((row, i) => (
            <Row key={i} style={{ marginTop: '20px' }}>
              {row.map((p, j) => (
                <Column
                  key={p.url}
                  style={{ width: '50%', verticalAlign: 'top', padding: j === 0 ? '0 8px 0 0' : '0 0 0 8px' }}
                >
                  <Link href={p.url}>
                    <Img src={p.imageUrl} alt={`${p.title}, open the photo`} style={photo} />
                  </Link>
                  <PhotoCaption p={p} />
                </Column>
              ))}
              {row.length === 1 && <Column style={{ width: '50%' }} />}
            </Row>
          ))}

          {more > 0 && (
            <Text style={{ ...s.muted, marginTop: '20px' }}>
              …and {more} more on the map.
            </Text>
          )}

          <Section style={{ margin: '28px 0 0', textAlign: 'center' }}>
            <Button href={`${baseUrl}/`} style={s.button}>
              Open the map
            </Button>
          </Section>

          <Hr style={s.hr} />
          <Text style={s.footer}>
            You&apos;re getting this because you subscribed on the map. It only comes in weeks with new
            photos.
          </Text>
          <Text style={s.footer}>
            <Link href={unsubscribeUrl} style={s.link}>
              Unsubscribe
            </Link>
            {' · '}
            <Link href={`${baseUrl}/feed.xml`} style={s.link}>
              RSS feed
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const sample = (n: number): DigestPhoto => ({
  title: `Sample photo ${n}`,
  url: `https://photos.vedantmodi.com/p/sample-${n}`,
  imageUrl: 'https://us-east-1.vedantmodi.com/yuccavalley-dawn_large.jpg',
  date: 'March 19, 2026',
});

DigestEmail.PreviewProps = {
  baseUrl: 'https://photos.vedantmodi.com',
  hero: sample(1),
  rest: [sample(2), sample(3), sample(4)],
  more: 0,
  unsubscribeUrl: 'https://example.com/unsubscribe',
} satisfies DigestEmailProps;
