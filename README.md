# LTI Postmessage Example Library

The following library is provided as an example of how to handle OIDC Login using platform storage via postmessage rather than cookies. This code is currently provided solely as an example and provides no guarantee.

## Build
The library can be built using the following command:
```
npm install
npm run build
```

## Initializing
Once built, include the compiled library from `lib/ltistorage.js` in your page.

To initialize the library run the following:
```JavaScript
window.ltiStorage = new LtiStorage(debugMode);
```
