# Native-language review: business "Customer messages" switch (20270428, 2026-11-18)

Generated from `src/i18n/ui/bizComp.js` on `post-tier1/business-web-only` (3ddc3818 and later). The 10 non-English languages
are machine-written. A native speaker checks each line, marks it OK or writes a correction, then the strings are
updated in that file. Not reviewed yet. This review gates calling the switch done (it doesn't gate the deploy order).

Context for reviewers: these are switches in a business owner's notification settings (app and website). "Customer
messages" must read as different from the owner's personal "Messages" switch, which they also see in Settings. Business
Mode uses informal "you" in German (du) and Spanish (tú).

Keys: `ui.bizComp.notifGroup.messages.label`, `ui.bizComp.notifGroup.messages.detail`, `ui.bizComp.notifGroup.requests.detail` (reworded: no longer mentions messages).

English source:

- Label: Customer messages
- Detail: A customer sends you a message.
- New requests detail (reworded): A customer asks for something you could offer, a request is about to expire, or a customer cancels one.

## Spanish (`es`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Mensajes de clientes | |
| messages.detail | Un cliente te envía un mensaje. | |
| requests.detail | Un cliente pide algo que podrías ofrecer, una solicitud está por vencer o un cliente cancela una. | |

## German (`de`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Kundennachrichten | |
| messages.detail | Ein Kunde schreibt dir eine Nachricht. | |
| requests.detail | Ein Kunde fragt nach etwas, das du anbieten könntest, eine Anfrage läuft bald ab oder ein Kunde storniert eine. | |

## French (`fr`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Messages de clients | |
| messages.detail | Un client vous envoie un message. | |
| requests.detail | Un client demande quelque chose que vous pourriez proposer, une demande va bientôt expirer ou un client en annule une. | |

## Portuguese (`pt`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Mensagens de clientes | |
| messages.detail | Um cliente envia uma mensagem para você. | |
| requests.detail | Um cliente pede algo que você poderia oferecer, um pedido está prestes a expirar ou um cliente cancela um. | |

## Haitian Creole (`ht`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Mesaj kliyan | |
| messages.detail | Yon kliyan voye yon mesaj ba ou. | |
| requests.detail | Yon kliyan mande yon bagay ou ta ka ofri, yon demann pral ekspire, oswa yon kliyan anile youn. | |

## Chinese (`zh`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | 顾客消息 | |
| messages.detail | 有顾客给你发送了消息。 | |
| requests.detail | 顾客请求了你可以提供的东西、某个请求即将过期，或顾客取消了请求。 | |

## Vietnamese (`vi`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Tin nhắn của khách hàng | |
| messages.detail | Một khách hàng gửi tin nhắn cho bạn. | |
| requests.detail | Khách hỏi điều bạn có thể đáp ứng, một yêu cầu sắp hết hạn, hoặc khách hủy một yêu cầu. | |

## Tagalog (`tl`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Mga mensahe ng customer | |
| messages.detail | May customer na nagpadala sa iyo ng mensahe. | |
| requests.detail | May customer na humihingi ng puwede mong ialok, may request na malapit nang mag-expire, o may customer na nagkansela. | |

## Russian (`ru`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | Сообщения клиентов | |
| messages.detail | Клиент отправил вам сообщение. | |
| requests.detail | Клиент просит то, что вы могли бы предложить, срок заявки скоро истекает, или клиент отменяет заявку. | |

## Korean (`ko`)

| Key | Machine-written text | OK / correction |
|---|---|---|
| messages.label | 고객 메시지 | |
| messages.detail | 고객이 메시지를 보냈습니다. | |
| requests.detail | 고객이 내가 제공할 수 있는 것을 요청하거나, 요청이 곧 만료되거나, 고객이 요청을 취소할 때. | |
