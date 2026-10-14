import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from 'react-email';

import { s } from './theme';

interface ConfirmEmailProps {
  confirmUrl: string;
}

export default function ConfirmEmail({ confirmUrl }: ConfirmEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={s.body}>
        <Preview>One click to get new photos from the map by email</Preview>
        <Container style={s.container}>
          <Text style={s.brand}>Photos by Vedant Modi</Text>
          <Heading as="h1" style={s.h1}>
            Confirm your subscription
          </Heading>
          <Text style={s.text}>
            Someone, hopefully you, asked to get an email when new photos go up on the map. It comes at
            most once a week, and only when there&apos;s something new.
          </Text>
          <Section style={{ margin: '8px 0 24px' }}>
            <Button href={confirmUrl} style={s.button}>
              Confirm subscription
            </Button>
          </Section>
          <Text style={s.muted}>This link works for 48 hours.</Text>
          <Hr style={s.hr} />
          <Text style={s.footer}>
            If this wasn&apos;t you, ignore this email. Nothing happens until the link is clicked.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

ConfirmEmail.PreviewProps = {
  confirmUrl: 'https://photos.vedantmodi.com/subscribe/confirm?token=example',
} satisfies ConfirmEmailProps;
