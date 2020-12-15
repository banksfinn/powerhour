let express = require('express'); // Express web server framework
let router = express.Router();
let path = require('path');
const fetch = require("node-fetch");
let bodyParser = require('body-parser');
let config = require('../config');
let btoa = require('btoa');


function getID(track) {
    return track['track']['id'];
}

function getID2(track) {
    return track['id'];
}

async function sendRequest(req_cookies, res, url, data) {
    data.headers = { 'Authorization': 'Bearer ' + req_cookies['auth_token']};
    let response = await fetch(url, data);
    if (response.status === 401) {
        await updateAuthToken(req_cookies, res);
        return await sendRequest(req_cookies, res, url, data);
    } else if (response.status > 204) {
        console.log(url);
        console.log(data);
        console.log(response);
        //res.render('error', {error: response})
    } else {
        return response;
    }
}

async function updateAuthToken(req_cookies, res) {
    let url = 'https://accounts.spotify.com/api/token';
    let body = {'grant_type': 'refresh_token', 'refresh_token': req_cookies['refresh_token']};
    let headers = {'Authorization': 'Basic ' + btoa(config.client_id + ':' + config.client_secret)};
    let response = await fetch(url, {method: 'POST', headers: headers, body: JSON.stringify(body)});
    let json_version = await response.json();
    res.cookie('auth_token', json_version.access_token);
}

async function getSongList(album_id, req_cookies, res) {
    let url = 'https://api.spotify.com/v1/playlists/' + album_id;
    let response = await sendRequest(req_cookies, res, url, {method: 'GET'});

    const body = await response.json();
    let tracks = body['tracks']['items'];
    let ids = tracks.map(getID);
    if (ids.length < 60) {
        let artists = await getMostCommonArtists(tracks);
        let new_songs = await getRecommendations(10, ids.slice(0, 2), artists, req_cookies, res);
        ids.push(new_songs)
    }
    return ids;
}

async function getMostCommonArtists(tracks) {
    let data =  {};
    for (let i = 0; i < tracks.length; i++) {
        for (let j = 0; j < tracks[i]['track']['artists'].length; j++) {
            if (tracks[i]['track']['artists'][j]['id'] in data) {
                data[tracks[i]['track']['artists'][j]['id']] += 1;
            } else {
                data[tracks[i]['track']['artists'][j]['id']] = 1
            }
        }
    }
    // Create items array
    let items = Object.keys(data).map(function(key) {
        return [key, data[key]];
    });

    // Sort the array based on the second element
    items.sort(function(first, second) {
        return second[1] - first[1];
    });

    // Create a new array with only the first 5 items
    let result = [];
    for (let i = 0; i < items.slice(0, 2).length; i++) {
        result.push(items[i][0])
    }
    return result;
}

async function getRecommendations(num_songs, songs, artists, req_cookies, res) {
    let url = 'https://api.spotify.com/v1/recommendations?';
    url += 'limit='+num_songs.toString();
    url += '&market=US&seed_artists=' + artists.join();
    url += '&seed_genres=edm';
    url += '&seed_tracks=' + songs.join();
    url += '&min_popularity=20';
    let response = await sendRequest(req_cookies, res, url, {method: 'GET'});
    const body = await response.json();
    let tracks = body['tracks'];
    return tracks.map(getID2);
}

async function getHypePart(id, req_cookies, res) {
    let url = 'https://api.spotify.com/v1/audio-analysis/' + id;
    let response = await sendRequest(req_cookies, res, url, {method: 'GET'});
    const body = await response.json();

    let sections = body['segments'];
    let max_loudness = -1000;
    let max_index = -1;

    for (let i = 0; i < sections.length; i++) {
        if (sections[i]['loudness_max'] > max_loudness) {
            max_loudness = sections[i]['loudness_max'];
            max_index = i;
        }
    }
    // Now we have the loudest part, we want the stuff around
    let min_padding = 10;
    let time_before = -sections[max_index]['duration'];
    let start_position = max_index;
    while (start_position >= 0) {
        time_before += sections[start_position]['duration'];
        if (time_before > min_padding) {
            break;
        }
        start_position -= 1
    }
    let time_after = -sections[max_index]['duration'];
    let end_position = max_index;
    while (end_position < sections.size - 1) {
        time_after += sections[end_position]['duration'];
        if (time_after > min_padding) {
            break;
        }
        end_position += 1
    }
    let total_time = time_before + sections[max_index]['duration'] + time_after;
    while (total_time < 60) {
        if (start_position > 0 && end_position < sections.size - 1) {
            if (sections[start_position]['max_loudness'] > sections[end_position]['max_loudness']) {
                total_time += sections[start_position]['duration'];
                start_position -= 1;
            }
            else {
                total_time += sections[end_position]['duration'];
                end_position += 1;
            }
        } else if (start_position > 0) {
            total_time += sections[start_position]['duration'];
            start_position -= 1;
        } else {
            total_time += sections[end_position]['duration'];
            end_position += 1;
        }
    }
    return sections[start_position]['start']
}

async function beerTrack(req_cookies, res) {
    let url = 'https://api.spotify.com/v1/me/player/play';
    let main_body = {'uris': ['spotify:track:6eBHoGG2sSeaksUJyWPrde']};
    let data = {method: 'PUT', body: JSON.stringify(main_body)};
    await sendRequest(req_cookies, res, url, data);
}

async function getPlaylists(req_cookies, res) {
    let url = 'https://api.spotify.com/v1/me/playlists?limit=10';
    let response = await sendRequest(req_cookies, res, url, {method: 'GET'});
    let json_items = await response.json();
    let items = json_items['items'];
    let result = [];
    for (let i = 0; i < items.length; i++) {
        result.push({'id': items[i]['id'], 'name': items[i]['name']})
    }
    return result;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function play(album_id, req_cookies, res) {
    let songs = await getSongList(album_id, req_cookies, res);
    let url = 'https://api.spotify.com/v1/me/player/play';
    for (let i = 0; i < 60; i++) {
        let start_time = await getHypePart(songs[i], req_cookies, res);
        let body = {'uris': ['spotify:track:'+songs[i]], 'position_ms': start_time*1000};
        await sendRequest(req_cookies, res, url, {method: 'PUT', body: JSON.stringify(body)});

        await delay(9000);
        await beerTrack(req_cookies, res);
    }
}
router.use(bodyParser.urlencoded({ extended: false }));

router.post('/play' , async function(req, res) {
    res.sendStatus(200);
    await play(req.body['playlist'], req.cookies, res);
});

router.use('/', async function(req, res) {
    let playlists = await getPlaylists(req.cookies, res);
    res.render('application', {playlists:playlists});
});

module.exports = router;