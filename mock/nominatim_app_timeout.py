from flask import Flask, jsonify, request
import time

app = Flask(__name__)

@app.route('/reverse')
def reverse():
    lat = request.args.get('lat')
    lon = request.args.get('lon')
    # Simulerer timeout
    time.sleep(15)
    # Returner en liten statisk, plausibel respons
    return jsonify({
        'place_id': 1,
        'licence': 'Data © OpenStreetMap contributors',
        'osm_type': 'way',
        'osm_id': 123456,
        'lat': lat,
        'lon': lon,
        'display_name': 'Oslo, Norway',
        'address': {
            'city': 'Oslo',
            'country': 'Norway',
            'country_code': 'no'
        }
    })
    
@app.route('/Taxon/PickerSearch')
def taxon_picker_search():
    # Simulerer timeout
    time.sleep(15)
    # Returnerer en plausibel, men tom respons
    return jsonify([])

@app.route('/core/Sites/ByBoundingBox')
def ao_sites_by_bounding_box():
    # Simulerer timeout
    time.sleep(15)
    # Returnerer en plausibel, men tom respons
    return jsonify({'sites': []})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
