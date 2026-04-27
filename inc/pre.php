<?php
function get_svr_ip() { $ipaddress = ''; if (isset($_SERVER['HTTP_CLIENT_IP'])) $ipaddress = $_SERVER['HTTP_CLIENT_IP']; else if(isset($_SERVER['HTTP_X_FORWARDED_FOR'])) $ipaddress = $_SERVER['HTTP_X_FORWARDED_FOR']; else if(isset($_SERVER['HTTP_X_FORWARDED'])) $ipaddress = $_SERVER['HTTP_X_FORWARDED']; else if(isset($_SERVER['HTTP_FORWARDED_FOR'])) $ipaddress = $_SERVER['HTTP_FORWARDED_FOR']; else if(isset($_SERVER['HTTP_FORWARDED'])) $ipaddress = $_SERVER['HTTP_FORWARDED']; else if(isset($_SERVER['REMOTE_ADDR'])) $ipaddress = $_SERVER['REMOTE_ADDR']; else $ipaddress = 'UNKNOWN'; return $ipaddress;}
function get_env_ip() { $ipaddress = ''; if (getenv('HTTP_CLIENT_IP')) $ipaddress = getenv('HTTP_CLIENT_IP'); else if(getenv('HTTP_X_FORWARDED_FOR')) $ipaddress = getenv('HTTP_X_FORWARDED_FOR'); else if(getenv('HTTP_X_FORWARDED')) $ipaddress = getenv('HTTP_X_FORWARDED'); else if(getenv('HTTP_FORWARDED_FOR')) $ipaddress = getenv('HTTP_FORWARDED_FOR'); else if(getenv('HTTP_FORWARDED')) $ipaddress = getenv('HTTP_FORWARDED'); else if(getenv('REMOTE_ADDR')) $ipaddress = getenv('REMOTE_ADDR'); else $ipaddress = 'UNKNOWN'; return $ipaddress;}
$ip = get_svr_ip(); if ( !filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) { 
$ip = get_env_ip(); if ( !filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) { unset( $ip ); } }
$ips_x = file('./inc/x.txt', FILE_IGNORE_NEW_LINES);
if( isset( $ip ) && in_array( $ip, $ips_x ) ) { echo "your ip address (". $ip.") was detected on the 2023 neblink ip block list. script will die..."; exit; }
if ( isset( $_SERVER['HTTP_USER_AGENT'] ) && preg_match('/bot|crawl|slurp|spider|mediapartners|Mb2345Browser|LieBaoFast|MicroMessenger|zh-CN|zh_CN|Kinza/i', $_SERVER['HTTP_USER_AGENT'], $a,PREG_UNMATCHED_AS_NULL) == null ) { $bot = "false"; } else { $bot = "true"; }
 ///////////////////////////    ABOVE VALIDATES IP ADDRESS AGAINST BLOCKLIST & DEFINES IF $bot   \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\

if( isset( $_SERVER['QUERY_STRING'] ) ) {
	$s = $_SERVER["QUERY_STRING"];
	
	if ( !preg_match( "/^a-zA-Z1-7=%&?+/g", $s ) ) {	
		$q  = explode('&', urldecode( $s ) );
		$x = array();
		
		foreach( $q as $p ) {  							// Set $x array
			if (strpos($p, '=') === false) $p = '=';
			list($name, $value) = explode( '=', $p, 2 );
			$name = urldecode( $name );
			$value = urldecode( $value );
			$value = str_replace( "b", "♭", $value );
			$value = str_replace( "#", "♯", $value );
			$x[$name][] = $value;
		}
		
		if ( isset( $x['x'][0] ) ) {
		foreach ( $tunings as $a => $b ) { 		// verify tuning is in tunings array
			if ( $a == $x['x'][0] ) {
				
				$tunin = "yes";
				break;
			} else {
				$tunin = "no";
			}
		}
		}
		if ( $tunin == "no" ) {			
			$def = "y";
			$errors .= "[Default options applied, Unacceptable x parameter - Found: ".$def.": ".$x['x'][0]."]
";			$bot = "false";
		} else { 								//  set $x[x]
			$x['x'] = $x['x'][0];
		}		
		
		foreach( $url_note_check as $n ) {				//  checks for bad characters in the following keys: $url_note_check = array( "k","s1","s2","s3","s4","s5","s6","s7","s8" );
			if ( !preg_match( "/[^A-G#]+/g", $x[$n][0] ) ) { 
				$x[$n] = $x[$n][0];
				
			} else {
				$def = "y"; 
				$errors .= "[Default options applied, Bad $n parameter]
";				$bot = "false";
			}	
		}
		
		foreach( $url_check as $o ) {					//	checks for bad characters in the following keys: $url_check = array( "y","z" );
			if ( !preg_match( "/[^yn]+/g", $x[$o][0] ) ) { 
				$x[$o] = $x[$o][0];
				
			} else {
				$def = "y";
				$errors .= "[Default options applied, Bad $o parameter]
";				$bot = "false";
				unset( $x[$o] );
			}	
		} 
		
		if ( isset( $x['hl'][0] ) ) {					// set $x[hl]
			$hl = implode( " ", $x['hl'] );
			if ( !preg_match( "/[^1-7b]+/g", $hl ) ) { 
				$x['hl'] = $hl;
			} else {
				$def = "y";
				$errors .= "[Default options applied, Bad hl parameter value: ".$hl."]
";				$bot = "false";
				unset( $x['hl']);
			}
		} else {
			$x['hl'] = "nothing";
		}
	} else {								//	url query is set but has bad characters
		$def = "y"; 
		$errors .= "[Default options applied, Unacceptable characters in URL: ".preg_replace( "/[^[:alnum:]=%&?]+/g", "", $s )."]
";		$bot = "false";
	}
} 

if ( $def == "y" ) {						//	populate $x with defaults if $def is y
	foreach ( $def_x as $k => $v ) {
		$x[$k] = $v;
	}
} else {									//  populate only the unset $x keys with $def if $def is n  <-- this should never happen right?
	foreach ( $def_x as $k => $v ) {
		if ( !isset( $x[$k] ) || $x[$k]=="" || is_array( $x[$k] ) ) {
			$x[$k] = $v;
		} 
	}
}

/////////////////////////////////////////	Default $x variables are set, now get $tunings array variables  	////////////////////////////////////////////

foreach ( $tunings[$x['x']] as $key => $value ) {			//  Get tuning arr from $tunings arr and make $x keys => values
	$x[$key] = $value;
}

unset( $x[''] );
$ess = "";
for( $i=12; $i>=1; $i-- ) {
	if ( in_array( $x['s'.$i], $keys, false ) ) {
		$ess .= $x['s'.$i]." ";
	}
}
$ess =  trim( $ess );
//if( count( explode(" ",$ess) ) > $x['strs'] ) { $x['strs'] = count( explode(" ",$ess) ); }
$x['s'] = $ess;
$x['rev_s'] = do_reverse_stuff( $ess );

if ( $x['z'] == "y" ) { 
	$x['d_name'] = "Custom";
	$x['d_notes'] = $x['s'];
} else { 
	$x['d_name'] = $x['name'];
	$x['d_notes'] = $x['notes'];
}
$x['rev_yy'] = "High to Low";
$x['yy'] = "Low to High";
if ( $x['y'] == "y" ) {										//	High to Low text and reverse display notes and degrees
	$rev = "rev_";
} else {
	$rev = "";
}

$notesplode = array_reverse( explode( " ", $x['notes'] ) );	//	explode and isolate notes 

for ( $a=1;$a<=12;$a++ ) {
	$x['x'.$a] = $notesplode[$a-1];
}
$url_s = "";
for ( $a=12;$a>=1;$a-- ) {									//  begin generating urls for links
	$url_s .= "s".$a."=".urlencode( str_replace( "♯","#",$x['s'.$a]) )."&";
}
$x['s'] = trim( $x['s'] );
$x['rev_s'] = trim( $x['rev_s'] );

$x['hl_arr'] = explode(" ", $x['hl'] );
$url_hl = "";
if ( is_array( $x['hl_arr'] )){
	foreach ( $x['hl_arr'] as $k => $v ) {
		$v = str_replace( "♭", "b", $v );
		$url_hl .= "hl=".$v."&";
	}
	$x['url_hl'] = $url_hl;
} else {
	$x['url_hl'] = "";
}
foreach ( $degrees as $v ) { 								//	establish isolated highlighted degree keys in $x
	if ( in_array( $v, $x['hl_arr'], false ) ) {
		$x['hl_'.str_replace( "♭", "b", $v )] = "y";
	} else {
		$x['hl_'.str_replace( "♭", "b", $v )] = "n";
	}
}
unset( $x['hl_arr'] );

$a = array_search( $x['k'], $keys, false );
for ( $b=0; $b<=11; $b++ ) {
	$z = $degrees[$b]; 
	$notedegrees[$z] = $keys[$a+$b];
}

for( $i=12;$i>=1;$i-- ) {
	$x['sdgs'.$i] = array_search( $x['s'.$i], $notedegrees, false );
	$sdgs[$i] = array_search( $x['s'.$i], $notedegrees, false );
}
$x['hl_name'] = "Highlighted: ";
foreach ( $scales as $a => $b ) {
	if ( "&".$x['url_hl'] == $b."&" ) {
		$x['hl_name'] .= str_replace( "_", " ", $a )." Scale";
		$x['hl_n'] .= str_replace( "_", " ", $a );
	}
}
if ( $x['hl_name'] == "Highlighted: " ) {
	foreach ( $chords as $a => $b ) {
		if ( "&".$x['url_hl'] == $b."&" ) {
			$x['hl_name'] .= str_replace( "_", " ", $a )." Chord";
			$x['hl_n'] .= str_replace( "_", " ", $a );
		}
	}
}
if ( $x['hl_name'] == "Highlighted: " ) {
	foreach ( $grid as $a => $b ) {
		if ( "&".$x['url_hl'] == $b."&" ) {
			$x['hl_name'] .= str_replace( "_", " ", $a )." Chord";
			$x['hl_n'] .= str_replace( "_", " ", $a );
		}
	}
}
$x['hl_name'] .= " (".$x['hl'].")";

$x['sdgs'] = trim( implode( " ", $sdgs ) );
$x['rev_sdgs'] = do_reverse_stuff( $x['sdgs'] );
$x['url_s'] = $url_s;
$x['url_x'] = "x=".$x['url_notes']."&";  							//	make url sections for links
$x['url_k'] = "k=".$x['k']."&";
$x['url_y'] = "y=".$x['y']."&";
$x['url_z'] = "z=".$x['z']."&";
$hilight_url = $self.$x['url_k'].$x['url_x'].$x['url_y'].$x['url_z'].$x['url_s'];



$tunings_csv = "name,			tuning,			degrees,			strings";
foreach ( $tunings as $key => $value ) {
	$tunings_csv .= "
".$tunings[$key]['name'].",			".str_replace( " ", "", $tunings[$key]['notes'] ).",			".str_replace( " ", "", $tunings[$key]['dgs'] ).",			".$tunings[$key]['strs']."-string";
}
$tunings_php = var_export($tunings,true);
$view_source_top = 
"
<!--////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 
 
 
  ███████ ██       █████  ███    ██ ████████ ███████ ██ ███    ██ ██████  ███████ ██████      
  ██      ██      ██   ██ ████   ██    ██    ██      ██ ████   ██ ██   ██ ██      ██   ██    
  ███████ ██      ███████ ██ ██  ██    ██    █████   ██ ██ ██  ██ ██   ██ █████   ██████     
       ██ ██      ██   ██ ██  ██ ██    ██    ██      ██ ██  ██ ██ ██   ██ ██      ██   ██    
  ███████ ███████ ██   ██ ██   ████    ██    ██      ██ ██   ████ ██████  ███████ ██   ██ .pro  
   
   
   
  <<<:::-----       SlantFinder.pro    ::    AutoLog Generated:  ".$now."       -----:::>>>


  --BEGIN--MUMBO--JUMBO-- 
  URL:  ".$_SERVER['PHP_SELF'].$_SERVER["QUERY_STRING"]."
  IS BOT:  ".$bot."
  USER AGENT:  ".$_SERVER['HTTP_USER_AGENT']."
  IP ADDRESS:  ".$ip."   
  REFERRER:  ".$_SERVER['HTTP_REFERER']."
  ERRORS:  ".$errors."
  Key:  ".$x['k']."    Tuning:  ".$x['x']."    
  --END--MUMBO--JUMBO-- 


  This site was created to be as free, accurate, and useful as possible within my coding abilities and music theory knowledge (lacking).
  It is designed for screen widths > 1024px because fretboards are wide and steel players are old.
  Requests, corrections, additions, suggestions:  https://bb.steelguitarforum.com/viewtopic.php?t=396088
  		  
  SlantFinder.pro fretboard visualization tool for 6-, 8-, 10-, & 12-string steel guitars 
  		  
  Including:
    Auto-populate the fretboard with 80+ tunings from dropdown menu
    Make your own custom Tuning
    Degrees displayed with notes on fretboard
    Changable key and highlight-able Degrees with consistent color scheme for degrees
    Quicklinks for highlighting common scales/chords (preserves tunings/options) 
    Formatted, low-ink fretboard printing, to print degree highlights enable Background Graphics in the print preview window.
    Chord structure grid, with chord names linked to highlight those corresponding Degrees (visible on screen sizes > 1200 for now )
    Piano keyboard visualization with octaves, frequencies, and steel gauges (visible on screen sizes > 1200 for now )
    Sortable and filterable list of 80+ tunings for 6-,8-,10-,& 12-string steel guitars 
      with names linked to highlight the fretboard with that tuning
    Copyable tunings list formatted for .CSV in the bottom of source code: # of strings, tuning name, tuning, degrees
  			
  Excluding:
    Ads, pop-ups, sign-ups, tracking, cookies, distractions, copyrights, subscriptions, images, bloat
   
  Hello? is this thing on?  Oh well.


  <<<:::-----       SlantFinder.pro    ::    AutoLog Generated:  ".$now."       -----:::>>>
  		  
		  
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////-->";


?>