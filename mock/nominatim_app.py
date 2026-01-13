from flask import Flask, jsonify, request

app = Flask(__name__)

@app.route('/reverse')
def reverse():
    lat = request.args.get('lat')
    lon = request.args.get('lon')
    # Return a small static but plausible response
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
