#!/bin/bash
curl --compressed -s 'https://www.artsobservasjoner.no/Map/GetSitesGeoJson' \
  -X POST \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0' \
  -H 'Accept: */*' \
  -H 'Content-Type: application/json; charset=UTF-8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Origin: https://www.artsobservasjoner.no' \
  -H 'Referer: https://www.artsobservasjoner.no/SubmitSighting/Report' \
  -H 'Cookie: AcceptCookies=1; __RequestVerificationToken=b5U3b8z4TY3HnoCVlqpaf7mopnkf7DVViGU_Ksx-NCmYVih3b2DZPeFaY1yiYOSP5Kn9lCn0bBzKdT3pUR3iCRnRhOs1; .ASPXAUTHNO=7025F99E8D84BA9D13F4149580C1E57F4DDC9B65485AC28682E4C4FCF4C5C3C0EDA312D51EF88E1BC44C12F7853D979EFECF4ADF073BCA07EA7BEF725BFB744AF4EFED91C30B9448011F16BA6ADC3362E284C6D87A10A18CC948F1276746986DE89E9BFDC7EA54B6C0F38B62D509AD27C6CF5205; logintoken=290628:1b468755c0676437272dbd42a0456cd1ca3d122915e6620d976720148f35a87c' \
  -d '{"zoomLevel":16,"bbox":"592430.5028571428,8487224,592605.4971428572,8487400","userId":15969,"coordSyst":0,"speciesGroupId":"0","taxonId":null}'
