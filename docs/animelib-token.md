# как достать токен animelib

Токен нужен только ради собственного плеера AnimeLib — прямых mp4 до 2160p.
Без него приложение работает, но AnimeLib отдаёт только ссылки на Kodik.
Аккаунт бесплатный.

## сначала проверь, что ты вошёл

Открой [v5.animelib.org](https://v5.animelib.org) и убедись, что в правом
верхнем углу стоит твой аватар, а не кнопка входа. Если ты не залогинен,
токена не существует нигде — ни в хранилище, ни в запросах.

## способ, который работает всегда

На любой странице v5.animelib.org открой консоль:

- Firefox: `⌥⌘K` (macOS) или `Ctrl+Shift+K`
- Chrome: `⌥⌘J` (macOS) или `Ctrl+Shift+J`

Firefox и Chrome при первой вставке в консоль требуют разрешения: Firefox
попросит напечатать `allow pasting`, Chrome — `allow pasting` тоже. Напечатай
это, нажми Enter, потом вставляй скрипт.

```js
(() => { const seen = new Set(); const show = (where, raw) => { const t = String(raw || "").replace(/^Bearer\s+/i, "").trim(); if (t.length < 20 || seen.has(t)) return; seen.add(t); console.log("%c" + where + ":", "color:#0a0;font-weight:bold"); console.log(t); }; for (const [name, store] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]]) { for (const [k, v] of Object.entries(store)) { const found = String(v).match(/eyJ[A-Za-z0-9._~+/=-]{20,}/g) || []; found.forEach((t) => show(name + " → " + k, t)); } } const setHeader = XMLHttpRequest.prototype.setRequestHeader; XMLHttpRequest.prototype.setRequestHeader = function (name, value) { if (String(name).toLowerCase() === "authorization") show("перехвачено в запросе", value); return setHeader.apply(this, arguments); }; const original = window.fetch; window.fetch = function (input, init) { try { const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined)); show("перехвачено в запросе", h.get("authorization")); } catch (e) {} return original.apply(this, arguments); }; console.log("Слежу за запросами. Переключи серию или озвучку — токен появится здесь."); })();
```

Он делает две вещи. Сначала обходит `localStorage` и `sessionStorage` и печатает
всё, что похоже на JWT, — не важно, под каким ключом сайт его хранит. Потом
подменяет отправку запросов и печатает заголовок `Authorization`, как только
страница его пошлёт. Если после вставки ничего не вывелось — переключи серию
или озвучку, это вызовет запрос к API.

Токен — длинная строка, начинающаяся с `eyJ`. Скопируй её целиком и вставь
в настройки приложения.

## способ через вкладку «Сеть»

Открой любую серию, в devtools вкладку «Сеть», фильтр `episodes`. Там будет
две строки с одинаковым именем:

| метод | что это | есть ли токен |
| --- | --- | --- |
| `OPTIONS` | предзапрос CORS | **нет**, он только объявляет заголовки |
| `GET` | сам запрос | **да**, в заголовках запроса |

Нужна строка с `GET`. В её заголовках запроса найди `Authorization` и скопируй
всё после слова `Bearer`.

Проще: правый клик по строке `GET` → «Копировать как cURL» → вставить целиком
в поле токена в настройках. Приложение само вытащит токен из команды.

## куда вставлять

Настройки → AnimeLib → «Токен доступа». Токен хранится в локальной базе SQLite
на твоём компьютере и уходит только в AnimeLib.

Никому его не показывай и не вставляй в переписку: это ключ от твоего аккаунта.
Если он куда-то утёк — выйди из аккаунта на сайте и войди заново, старый токен
перестанет действовать.
